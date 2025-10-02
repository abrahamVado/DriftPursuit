import { useCallback, useEffect, useRef } from "react";

export interface InputState {
  throttle: number;
  roll: number;
  pitch: number;
  yaw: number;
  boost: boolean;
  resetRoll: boolean;
}

export interface ControlCallbacks {
  onLaserToggle?: (active: boolean) => void;
  onFireMissile?: () => void;
}

export function useSandboxControls() {
  const inputRef = useRef<InputState>({
    throttle: 0,
    roll: 0,
    pitch: 0,
    yaw: 0,
    boost: false,
    resetRoll: false,
  });

  const callbacksRef = useRef<ControlCallbacks>({});

  const setCallbacks = useCallback((callbacks: ControlCallbacks) => {
    callbacksRef.current = callbacks;
    return () => {
      if (callbacksRef.current === callbacks) {
        callbacksRef.current = {};
      }
    };
  }, []);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code.startsWith("Arrow")) {
        event.preventDefault();
      }

      if (event.code === "KeyW") inputRef.current.throttle = 1;
      if (event.code === "KeyS") inputRef.current.throttle = -1;
      if (event.code === "KeyA") inputRef.current.roll = -1;
      if (event.code === "KeyD") inputRef.current.roll = 1;
      if (event.code === "ArrowUp") inputRef.current.pitch = 1;
      if (event.code === "ArrowDown") inputRef.current.pitch = -1;
      if (event.code === "ArrowLeft") inputRef.current.yaw = -1;
      if (event.code === "ArrowRight") inputRef.current.yaw = 1;
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        inputRef.current.boost = true;
      }
      if (event.code === "Space") inputRef.current.resetRoll = true;

      if (event.code === "KeyL") {
        callbacksRef.current.onLaserToggle?.(true);
      }

      if (event.code === "KeyM") {
        callbacksRef.current.onFireMissile?.();
      }
    };

    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "KeyW" && inputRef.current.throttle > 0) {
        inputRef.current.throttle = 0;
      }
      if (event.code === "KeyS" && inputRef.current.throttle < 0) {
        inputRef.current.throttle = 0;
      }
      if (event.code === "KeyA" || event.code === "KeyD") {
        inputRef.current.roll = 0;
      }
      if (event.code === "ArrowUp" && inputRef.current.pitch > 0) {
        inputRef.current.pitch = 0;
      }
      if (event.code === "ArrowDown" && inputRef.current.pitch < 0) {
        inputRef.current.pitch = 0;
      }
      if (event.code === "ArrowLeft" && inputRef.current.yaw < 0) {
        inputRef.current.yaw = 0;
      }
      if (event.code === "ArrowRight" && inputRef.current.yaw > 0) {
        inputRef.current.yaw = 0;
      }
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        inputRef.current.boost = false;
      }
      if (event.code === "KeyL") {
        callbacksRef.current.onLaserToggle?.(false);
      }
    };

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, []);

  return { inputRef, setCallbacks };
}
