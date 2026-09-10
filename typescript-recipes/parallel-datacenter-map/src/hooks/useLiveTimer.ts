"use client";

import { useState, useEffect, useCallback } from "react";

const SYNC_INTERVAL = 30;

export function useLiveTimer(onTick?: () => void) {
  const [syncTime, setSyncTime] = useState<Date>(new Date());
  const [countdown, setCountdown] = useState(SYNC_INTERVAL);

  const handleTick = useCallback(() => {
    setSyncTime(new Date());
    onTick?.();
  }, [onTick]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          handleTick();
          return SYNC_INTERVAL;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [handleTick]);

  const timeStr = syncTime.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  return { timeStr, countdown };
}
