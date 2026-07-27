import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Shell } from "./components/Shell";
import { Modal } from "./components/Modal";
import {
  CliCatalog,
  Dashboard,
  Deploy,
  Documentation,
  Editor,
  Manager,
  Playground,
  Projects,
  Runs,
  Settings,
  Skills,
  Tests,
} from "./pages/Pages";
import { useStudio } from "./store";
import { isTauri } from "./services/ai";

const pages = [
  ["/", Dashboard],
  ["/projects", Projects],
  ["/skills", Skills],
  ["/playground", Playground],
  ["/tests", Tests],
  ["/runs", Runs],
  ["/manager", Manager],
  ["/docs", Documentation],
  ["/deploy", Deploy],
  ["/clis", CliCatalog],
  ["/settings", Settings],
] as const;

export default function App() {
  const theme = useStudio((state) => state.theme);
  const location = useLocation();
  const navigate = useNavigate();
  const visitedPages = useRef(new Set<string>());
  const visitedEditors = useRef(new Set<string>());
  const allowClose = useRef(false);
  const [closePrompt, setClosePrompt] = useState(false);
  const editorMatch = location.pathname.match(/^\/skills\/([^/]+)\/editor$/);
  const currentPage = pages.find(([path]) => path === location.pathname)?.[0];
  const recognized = Boolean(currentPage || editorMatch);

  if (currentPage) visitedPages.current.add(currentPage);
  if (editorMatch)
    visitedEditors.current.add(decodeURIComponent(editorMatch[1]));

  useEffect(() => {
    if (!recognized) navigate("/", { replace: true });
  }, [navigate, recognized]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (allowClose.current) return;
        event.preventDefault();
        setClosePrompt(true);
      })
      .then((next) => {
        unlisten = next;
      });
    return () => unlisten?.();
  }, []);

  return (
    <div data-theme={theme}>
      <Shell>
        {pages.map(([path, Page]) =>
          visitedPages.current.has(path) ? (
            <div
              className="route-view"
              hidden={location.pathname !== path}
              key={path}
            >
              <Page />
            </div>
          ) : null,
        )}
        {[...visitedEditors.current].map((skillId) => {
          const path = `/skills/${encodeURIComponent(skillId)}/editor`;
          return (
            <div
              className="route-view"
              hidden={location.pathname !== path}
              key={path}
            >
              <Editor skillId={skillId} />
            </div>
          );
        })}
      </Shell>
      {closePrompt && (
        <Modal
          title="Close Skill Studio?"
          onClose={() => setClosePrompt(false)}
        >
          <p>
            Are you sure you want to close the application? Active tests, model
            requests, installs, and code runs will stop.
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setClosePrompt(false)}>
              Keep working
            </button>
            <button
              className="button danger"
              onClick={async () => {
                allowClose.current = true;
                await getCurrentWindow().destroy();
              }}
            >
              Close application
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
