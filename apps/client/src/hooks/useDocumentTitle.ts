import { useEffect } from "preact/hooks";

export function useDocumentTitle(fileName: string) {
  useEffect(() => {
    document.title = fileName.split(/\\|\//).pop() || "Markdown Preview";
  }, [fileName]);
}
