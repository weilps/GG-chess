use reqwest::{
    header::{
        HeaderMap, HeaderValue, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED, RETRY_AFTER,
    },
    redirect::Policy,
    Client, StatusCode,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;

const API_BASE_URL: &str = "https://api.chess.com";
const USER_AGENT: &str = "ChessMate/0.1 (+https://github.com/weilps/GG-chess)";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RESPONSE_BYTES: usize = 50 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChessComCacheRequest {
    pub username: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChessComMonthRequest {
    pub username: String,
    pub year: u16,
    pub month: u8,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChessComArchivesResponse {
    pub not_modified: bool,
    pub months: Vec<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct ChessComGame {
    pub pgn: String,
    pub rules: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChessComMonthResponse {
    pub not_modified: bool,
    pub games: Vec<ChessComGame>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ArchivesPayload {
    archives: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct MonthPayload {
    games: Vec<ChessComGame>,
}

#[derive(Debug, Clone, PartialEq)]
struct CacheHeaders {
    etag: Option<String>,
    last_modified: Option<String>,
}

enum FetchOutcome<T> {
    Modified(T, CacheHeaders),
    NotModified(CacheHeaders),
}

struct ChessComClient {
    client: Client,
    base_url: String,
}

impl ChessComClient {
    fn production() -> Result<Self, String> {
        Self::new(API_BASE_URL)
    }

    fn new(base_url: &str) -> Result<Self, String> {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .gzip(true)
            .redirect(Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|_| "chess_com_failed".to_string())?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }

    async fn archives(
        &self,
        request: ChessComCacheRequest,
    ) -> Result<ChessComArchivesResponse, String> {
        let username = normalize_username(&request.username)?;
        let endpoint = format!("{}/pub/player/{}/games/archives", self.base_url, username);
        match self
            .fetch_json::<ArchivesPayload>(&endpoint, request.etag, request.last_modified)
            .await?
        {
            FetchOutcome::NotModified(cache) => Ok(ChessComArchivesResponse {
                not_modified: true,
                months: Vec::new(),
                etag: cache.etag,
                last_modified: cache.last_modified,
            }),
            FetchOutcome::Modified(payload, cache) => {
                let mut months = Vec::with_capacity(payload.archives.len());
                for archive in payload.archives {
                    months.push(parse_archive_month(&archive, &username)?);
                }
                months.sort();
                months.dedup();
                Ok(ChessComArchivesResponse {
                    not_modified: false,
                    months,
                    etag: cache.etag,
                    last_modified: cache.last_modified,
                })
            }
        }
    }

    async fn month(&self, request: ChessComMonthRequest) -> Result<ChessComMonthResponse, String> {
        let username = normalize_username(&request.username)?;
        if !(1900..=2200).contains(&request.year) || !(1..=12).contains(&request.month) {
            return Err("chess_com_invalid_month".to_string());
        }
        let endpoint = format!(
            "{}/pub/player/{}/games/{}/{:02}",
            self.base_url, username, request.year, request.month
        );
        match self
            .fetch_json::<MonthPayload>(&endpoint, request.etag, request.last_modified)
            .await?
        {
            FetchOutcome::NotModified(cache) => Ok(ChessComMonthResponse {
                not_modified: true,
                games: Vec::new(),
                etag: cache.etag,
                last_modified: cache.last_modified,
            }),
            FetchOutcome::Modified(payload, cache) => Ok(ChessComMonthResponse {
                not_modified: false,
                games: payload.games,
                etag: cache.etag,
                last_modified: cache.last_modified,
            }),
        }
    }

    async fn fetch_json<T: DeserializeOwned>(
        &self,
        endpoint: &str,
        etag: Option<String>,
        last_modified: Option<String>,
    ) -> Result<FetchOutcome<T>, String> {
        for attempt in 0..=1 {
            let mut request = self.client.get(endpoint);
            if let Some(value) = safe_cache_header(etag.as_deref())? {
                request = request.header(IF_NONE_MATCH, value);
            }
            if let Some(value) = safe_cache_header(last_modified.as_deref())? {
                request = request.header(IF_MODIFIED_SINCE, value);
            }

            let response = request.send().await.map_err(map_request_error)?;
            if response.status() == StatusCode::TOO_MANY_REQUESTS && attempt == 0 {
                let delay = retry_delay(response.headers());
                tokio::time::sleep(delay).await;
                continue;
            }

            let status = response.status();
            let cache = cache_headers(response.headers());
            if status == StatusCode::NOT_MODIFIED {
                return Ok(FetchOutcome::NotModified(cache));
            }
            match status {
                StatusCode::MOVED_PERMANENTLY => return Err("chess_com_redirected".to_string()),
                StatusCode::NOT_FOUND => return Err("chess_com_not_found".to_string()),
                StatusCode::GONE => return Err("chess_com_gone".to_string()),
                StatusCode::TOO_MANY_REQUESTS => return Err("chess_com_rate_limited".to_string()),
                StatusCode::OK => {}
                _ => return Err("chess_com_failed".to_string()),
            }
            if response
                .content_length()
                .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
            {
                return Err("chess_com_response_too_large".to_string());
            }
            let body = response.bytes().await.map_err(map_request_error)?;
            if body.len() > MAX_RESPONSE_BYTES {
                return Err("chess_com_response_too_large".to_string());
            }
            let payload = serde_json::from_slice::<T>(&body)
                .map_err(|_| "chess_com_invalid_response".to_string())?;
            return Ok(FetchOutcome::Modified(payload, cache));
        }
        Err("chess_com_rate_limited".to_string())
    }
}

fn normalize_username(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    let valid_characters = normalized
        .bytes()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, b'_' | b'-'));
    let valid_edges = normalized
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_alphanumeric)
        && normalized
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric);
    if normalized.is_empty() || normalized.len() > 25 || !valid_characters || !valid_edges {
        return Err("chess_com_invalid_username".to_string());
    }
    Ok(normalized)
}

fn parse_archive_month(value: &str, username: &str) -> Result<String, String> {
    let prefix = format!("https://api.chess.com/pub/player/{}/games/", username);
    let suffix = value
        .strip_prefix(&prefix)
        .ok_or_else(|| "chess_com_invalid_response".to_string())?;
    let parts = suffix.split('/').collect::<Vec<_>>();
    if parts.len() != 2
        || parts[0].len() != 4
        || parts[1].len() != 2
        || parts[0].parse::<u16>().is_err()
        || !matches!(parts[1].parse::<u8>(), Ok(1..=12))
    {
        return Err("chess_com_invalid_response".to_string());
    }
    Ok(format!("{}-{}", parts[0], parts[1]))
}

fn safe_cache_header(value: Option<&str>) -> Result<Option<HeaderValue>, String> {
    value
        .filter(|value| !value.is_empty())
        .map(|value| {
            if value.len() > 512 {
                return Err("chess_com_invalid_cache".to_string());
            }
            HeaderValue::from_str(value).map_err(|_| "chess_com_invalid_cache".to_string())
        })
        .transpose()
}

fn cache_headers(headers: &HeaderMap) -> CacheHeaders {
    CacheHeaders {
        etag: headers
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string),
        last_modified: headers
            .get(LAST_MODIFIED)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string),
    }
}

fn retry_delay(headers: &HeaderMap) -> Duration {
    let seconds = headers
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(1)
        .min(5);
    Duration::from_secs(seconds)
}

fn map_request_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "chess_com_timeout".to_string()
    } else if error.is_connect() {
        "chess_com_offline".to_string()
    } else {
        "chess_com_failed".to_string()
    }
}

#[tauri::command]
pub async fn chess_com_fetch_archives(
    request: ChessComCacheRequest,
) -> Result<ChessComArchivesResponse, String> {
    ChessComClient::production()?.archives(request).await
}

#[tauri::command]
pub async fn chess_com_fetch_month(
    request: ChessComMonthRequest,
) -> Result<ChessComMonthResponse, String> {
    ChessComClient::production()?.month(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    fn serve_once(response: &'static str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake server");
        let address = listener.local_addr().expect("fake server address");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut buffer = [0_u8; 4096];
            let count = stream.read(&mut buffer).expect("read request");
            stream
                .write_all(response.as_bytes())
                .expect("write response");
            String::from_utf8_lossy(&buffer[..count]).into_owned()
        });
        (format!("http://{address}"), handle)
    }

    #[test]
    fn normalizes_and_rejects_usernames() {
        assert_eq!(
            normalize_username("  Player_Name-2 ").unwrap(),
            "player_name-2"
        );
        for invalid in ["", "-player", "player-", "player/name", "échec"] {
            assert_eq!(
                normalize_username(invalid),
                Err("chess_com_invalid_username".into())
            );
        }
    }

    #[test]
    fn accepts_only_official_archive_urls() {
        assert_eq!(
            parse_archive_month(
                "https://api.chess.com/pub/player/erik/games/2026/08",
                "erik"
            )
            .unwrap(),
            "2026-08"
        );
        assert!(parse_archive_month("https://example.com/2026/08", "erik").is_err());
        assert!(parse_archive_month(
            "https://api.chess.com/pub/player/other/games/2026/08",
            "erik"
        )
        .is_err());
    }

    #[test]
    fn bounds_retry_after() {
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, HeaderValue::from_static("60"));
        assert_eq!(retry_delay(&headers), Duration::from_secs(5));
    }

    #[tokio::test]
    async fn uses_conditional_headers_and_accepts_not_modified() {
        let (base_url, server) = serve_once(
            "HTTP/1.1 304 Not Modified\r\nETag: fresh\r\nLast-Modified: Tue, 25 Aug 2026 00:00:00 GMT\r\nConnection: close\r\n\r\n",
        );
        let result = ChessComClient::new(&base_url)
            .unwrap()
            .month(ChessComMonthRequest {
                username: "Erik".into(),
                year: 2026,
                month: 8,
                etag: Some("old".into()),
                last_modified: Some("Mon, 24 Aug 2026 00:00:00 GMT".into()),
            })
            .await
            .unwrap();
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.starts_with("get /pub/player/erik/games/2026/08"));
        assert!(request.contains("if-none-match: old"));
        assert!(request.contains("if-modified-since: mon, 24 aug 2026 00:00:00 gmt"));
        assert!(result.not_modified);
        assert_eq!(result.etag.as_deref(), Some("fresh"));
    }

    #[tokio::test]
    async fn rejects_archive_urls_outside_the_official_host() {
        let body = r#"{"archives":["https://example.com/pub/player/erik/games/2026/08"]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let leaked: &'static str = Box::leak(response.into_boxed_str());
        let (base_url, server) = serve_once(leaked);
        let result = ChessComClient::new(&base_url)
            .unwrap()
            .archives(ChessComCacheRequest {
                username: "erik".into(),
                etag: None,
                last_modified: None,
            })
            .await;
        server.join().unwrap();
        assert_eq!(result, Err("chess_com_invalid_response".into()));
    }

    #[tokio::test]
    #[ignore = "requires network access to the public Chess.com API"]
    async fn public_archive_smoke() {
        let client = ChessComClient::production().unwrap();
        let archives = client
            .archives(ChessComCacheRequest {
                username: "erik".into(),
                etag: None,
                last_modified: None,
            })
            .await
            .unwrap();
        let latest = archives.months.last().expect("public archive month");
        let (year, month) = latest.split_once('-').expect("year-month");
        let games = client
            .month(ChessComMonthRequest {
                username: "erik".into(),
                year: year.parse().unwrap(),
                month: month.parse().unwrap(),
                etag: None,
                last_modified: None,
            })
            .await
            .unwrap();
        assert!(!games.games.is_empty());
    }
}
