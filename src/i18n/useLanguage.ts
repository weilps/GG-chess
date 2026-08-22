import { useCallback, useEffect, useState } from "react";
import type { Language } from "../types";
import { translate, type TranslationKey } from "./translations";

const LANGUAGE_STORAGE_KEY = "chessmate.language";

function getInitialLanguage(): Language {
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored === "fr" ? "fr" : "en";
}

export function useLanguage() {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    setLanguageState(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, variables?: Record<string, string | number>) =>
      translate(language, key, variables),
    [language],
  );

  return { language, setLanguage, t };
}
