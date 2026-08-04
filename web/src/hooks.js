import { useEffect, useState } from "react";

export function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || "dashboard");

  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || "dashboard");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (r) => {
    window.location.hash = r;
  };

  return [route, navigate];
}

export function usePoll(fn, interval = 5000, deps = []) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    fn();
    const id = setInterval(() => setTick((t) => t + 1), interval);
    return () => clearInterval(id);
  }, [...deps, tick]);
}
