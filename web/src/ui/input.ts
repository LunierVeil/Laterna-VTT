import { useEffect, useState } from "react";

export function useTouchInput() {
  const detect = () => navigator.maxTouchPoints > 0 || matchMedia("(any-pointer: coarse)").matches;
  const [touch, setTouch] = useState(detect);
  useEffect(() => {
    const media = matchMedia("(any-pointer: coarse)");
    const update = () => setTouch(detect());
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return touch;
}
