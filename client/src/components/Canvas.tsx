import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  hashElementsVersion,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import type { Proposal, SceneFile } from "@sdp/shared";
import { api } from "@/api";
import { buildProposalElements, type SceneElement } from "@/proposal";
import { setCanvasHandle, useApp } from "@/state";

const AUTOSAVE_MS = 1500;
const MAX_PNG_EDGE = 1400;

/** Fits the drawing in view without zooming in past 100%. */
function fitView(api: ExcalidrawImperativeAPI) {
  const elements = api.getSceneElements();
  if (!elements.length) return;
  api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.85 });
  if (api.getAppState().zoom.value > 1) {
    api.updateScene({ appState: { zoom: { value: 1 as never } } });
    api.scrollToContent(elements);
  }
}

type Props = { sessionId: string; initialScene: SceneFile | null; theme: "light" | "dark" };

/** Excalidraw wrapper: autosave, PNG export, and applying Claude's sketches. */
export default function Canvas({ sessionId, initialScene, theme }: Props) {
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI | null>(null);
  const savedVersion = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const setSaveStatus = useApp((s) => s.setSaveStatus);
  const checkWork = useApp((s) => s.checkWork);

  const initialData = useMemo(
    () =>
      initialScene
        ? {
            elements: initialScene.elements as unknown as ExcalidrawElement[],
            appState: { ...initialScene.appState, collaborators: undefined },
            files: initialScene.files as BinaryFiles,
            scrollToContent: true,
          }
        : { scrollToContent: true },
    [initialScene],
  );

  const currentScene = useCallback((): SceneFile | null => {
    if (!excalidraw) return null;
    const json = serializeAsJSON(
      excalidraw.getSceneElementsIncludingDeleted(),
      excalidraw.getAppState(),
      excalidraw.getFiles(),
      "local",
    );
    return JSON.parse(json) as SceneFile;
  }, [excalidraw]);

  const save = useCallback(
    async (keepalive = false) => {
      if (!excalidraw) return;
      const version = hashElementsVersion(excalidraw.getSceneElementsIncludingDeleted());
      if (savedVersion.current === version) return;
      const scene = currentScene();
      if (!scene) return;
      setSaveStatus("saving");
      try {
        await api.saveScene(sessionId, scene, keepalive);
        savedVersion.current = version;
        setSaveStatus("saved");
      } catch {
        // Retry on the next change.
        setSaveStatus("error");
      }
    },
    [excalidraw, currentScene, sessionId, setSaveStatus],
  );

  const flushSave = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) await saving.current;
    saving.current = save();
    await saving.current;
    saving.current = null;
  }, [save]);

  // Start from the loaded scene's version so opening a session does not trigger a save.
  if (savedVersion.current === null) {
    savedVersion.current = hashElementsVersion((initialScene?.elements ?? []) as unknown as ExcalidrawElement[]);
  }

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      if (hashElementsVersion(elements) === savedVersion.current) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void flushSave();
      }, AUTOSAVE_MS);
    },
    [flushSave],
  );

  const exportPng = useCallback(async (): Promise<Blob | null> => {
    if (!excalidraw) return null;
    const elements = excalidraw.getSceneElements();
    if (elements.length === 0) return null;
    return exportToBlob({
      elements,
      appState: {
        ...excalidraw.getAppState(),
        exportBackground: true,
        viewBackgroundColor: "#ffffff",
        exportWithDarkMode: false,
        exportEmbedScene: false,
      },
      files: excalidraw.getFiles(),
      exportPadding: 20,
      mimeType: "image/png",
      getDimensions: (width: number, height: number) => {
        const scale = Math.min(2, MAX_PNG_EDGE / Math.max(width, height));
        return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
      },
    });
  }, [excalidraw]);

  const applyProposal = useCallback(
    (proposal: Proposal) => {
      if (!excalidraw) return;
      const all = excalidraw.getSceneElementsIncludingDeleted();
      if (all.some((e) => !e.isDeleted && e.customData?.proposalId === proposal.id)) return;
      const { added, updated } = buildProposalElements(
        all as unknown as SceneElement[],
        proposal,
        (skeletons) =>
          convertToExcalidrawElements(skeletons as unknown as ExcalidrawElementSkeleton[], {
            regenerateIds: false,
          }) as unknown as SceneElement[],
      );
      if (!added.length) return;
      const replace = new Map(updated.map((e) => [e.id, e]));
      excalidraw.updateScene({
        elements: [...all.map((e) => replace.get(e.id) ?? e), ...added] as unknown as ExcalidrawElement[],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      // Fit the whole drawing so the sketch shows in context.
      fitView(excalidraw);
    },
    [excalidraw],
  );

  const resolveProposal = useCallback(
    (proposalId: string, decision: "accept" | "discard") => {
      if (!excalidraw) return;
      const all = excalidraw.getSceneElementsIncludingDeleted();
      const ours = new Set(all.filter((e) => e.customData?.proposalId === proposalId).map((e) => e.id));
      const bump = <T extends ExcalidrawElement>(e: T, patch: Partial<T>): T => ({
        ...e,
        ...patch,
        version: e.version + 1,
        versionNonce: Math.floor(Math.random() * 2 ** 31),
        updated: Date.now(),
      });
      const next = all.map((el) => {
        if (ours.has(el.id)) {
          // Keep: unlock and mark accepted; the violet stays so the user can tell it apart.
          return decision === "accept"
            ? bump(el, { locked: false, customData: { ...el.customData, status: "accepted" } })
            : bump(el, { isDeleted: true });
        }
        // Discard: drop arrow references the sketch added to the user's shapes. Nothing else changes.
        if (decision === "discard" && el.boundElements?.some((b) => ours.has(b.id))) {
          return bump(el, { boundElements: el.boundElements.filter((b) => !ours.has(b.id)) });
        }
        return el;
      });
      excalidraw.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    },
    [excalidraw],
  );

  // Show the whole drawing when a session opens.
  useEffect(() => {
    if (!excalidraw) return;
    const t = setTimeout(() => fitView(excalidraw), 50);
    return () => clearTimeout(t);
  }, [excalidraw]);

  useEffect(() => {
    if (!excalidraw) return;
    // Dev only: lets browser automation build test scenes.
    if (import.meta.env.DEV) (window as unknown as { __excalidraw?: ExcalidrawImperativeAPI }).__excalidraw = excalidraw;
    setCanvasHandle({
      getScene: () => currentScene()!,
      exportPng,
      flushSave,
      applyProposal,
      resolveProposal,
    });
    return () => setCanvasHandle(null);
  }, [excalidraw, currentScene, exportPng, flushSave, applyProposal, resolveProposal]);

  // Save on tab close. keepalive lets the request outlive the page (up to 64 KB).
  useEffect(() => {
    const onUnload = () => void save(true);
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [save]);

  // Switching sessions saves through flushSave() in the store before this unmounts. Saving from an
  // unmount cleanup is unsafe: Excalidraw has already torn down and reports an empty scene.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void checkWork();
    }
  };

  return (
    <div className="h-full w-full" onKeyDownCapture={onKeyDown}>
      <Excalidraw
        excalidrawAPI={setExcalidraw}
        initialData={initialData}
        onChange={onChange}
        theme={theme}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
      />
    </div>
  );
}
