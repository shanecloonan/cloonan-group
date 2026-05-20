"use client";

import { useCallback, useRef } from "react";

/** Fire `onLongPress` after `ms` on touch; cancel on move/up. */
export function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onTouchStart = useCallback(() => {
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      onLongPress();
    }, ms);
  }, [clear, ms, onLongPress]);

  const onTouchEnd = useCallback(() => clear(), [clear]);
  const onTouchMove = useCallback(() => clear(), [clear]);

  return { onTouchStart, onTouchEnd, onTouchMove, onTouchCancel: onTouchEnd };
}
