"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Custom hook for managing state persisted to sessionStorage.
 * Handles SSR by deferring storage reads until after hydration.
 *
 * @param key - The sessionStorage key
 * @param initialValue - Initial value before hydration or when no stored value exists
 * @returns Tuple of [state, setState, clearState, isHydrated]
 */
export function useSessionStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void, boolean] {
  // Use a ref to track if we've loaded from storage
  const hasLoadedRef = useRef(false);

  // Initialize state - during SSR or first render, use initialValue
  const [state, setStateInternal] = useState<T>(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);

  // Wrapper for setState that also persists to storage
  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStateInternal((prev) => {
        const newValue = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
        try {
          sessionStorage.setItem(key, JSON.stringify(newValue));
        } catch {
          // Ignore storage errors
        }
        return newValue;
      });
    },
    [key]
  );

  // Load from sessionStorage on mount
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Initial hydration from storage - this is a valid one-time initialization pattern
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStateInternal(parsed);
      }
    } catch {
      // Ignore errors from parsing or storage access
    }
    setIsHydrated(true);
  }, [key]);

  const clearState = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Ignore errors
    }
    setStateInternal(initialValue);
  }, [key, initialValue]);

  return [state, setState, clearState, isHydrated];
}
