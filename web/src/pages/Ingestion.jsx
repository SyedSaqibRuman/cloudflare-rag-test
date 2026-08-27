// --------------------------
// INGESTION PAGE — thin router.
// Checks for KB detail sub-routes (#ingestion/kbs/:key) and renders KbDetail.
// Otherwise renders IngestionList. No hooks called conditionally — the
// hooks violation that existed before is eliminated by this split.
// --------------------------

import { lazy, Suspense } from "react";
import { Spinner } from "../components/ui";

const IngestionList = lazy(() => import("./IngestionList.jsx"));
const KbDetail = lazy(() => import("./KbDetail.jsx"));

export default function Ingestion({ navigate, path }) {
  const segments = (path || "").split("/");
  const kbKey = segments[1] === "kbs" ? segments[2] : null;

  if (kbKey) {
    return (
      <Suspense fallback={<div className="flex items-center justify-center py-20"><Spinner className="h-6 w-6" /></div>}>
        <KbDetail navigate={navigate} path={`kbs/${kbKey}`} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Spinner className="h-6 w-6" /></div>}>
      <IngestionList navigate={navigate} />
    </Suspense>
  );
}
