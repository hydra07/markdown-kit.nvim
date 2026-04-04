import { useEffect } from "react";

export function useDocumentTitle(fileName: string) {
  useEffect(() => {
    document.title = fileName.split(/\\|\//).pop() || "Markdown Preview";
  }, [fileName]);
}
