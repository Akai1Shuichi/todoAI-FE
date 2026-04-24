import { useEffect, useRef, useState } from "react";

const API_BASE = "http://localhost:3333";

function clsx(...values) {
  return values.filter(Boolean).join(" ");
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [jobState, setJobState] = useState({
    status: "idle",
    jobId: null,
    logs: "",
    error: "",
  });
  const [repoPathInput, setRepoPathInput] = useState("");
  const [defaultRepoPath, setDefaultRepoPath] = useState("");
  const [activeRepoPath, setActiveRepoPath] = useState("");
  const [todoFile, setTodoFile] = useState("");
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const terminalRef = useRef(null);
  const streamRef = useRef(null);

  async function loadTasks(repoPath) {
    const nextRepoPath = repoPath.trim();

    if (!nextRepoPath) {
      setTasks([]);
      setTodoFile("");
      setSelectedTaskId(null);
      setActiveRepoPath("");
      setJobState((current) => ({
        ...current,
        error: "Repo path is required.",
      }));
      return;
    }

    setIsLoadingTasks(true);

    try {
      const response = await fetch(`${API_BASE}/api/tasks/load`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repoPath: nextRepoPath,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "Failed to load tasks.");
      }

      setTasks(data.tasks ?? []);
      setTodoFile(data.todoFile ?? "");
      setActiveRepoPath(nextRepoPath);
      setSelectedTaskId((current) => {
        const nextId = current ?? data.tasks?.[0]?.id ?? null;
        return data.tasks?.some((task) => task.id === nextId)
          ? nextId
          : data.tasks?.[0]?.id ?? null;
      });
      setJobState((current) => ({
        ...current,
        error: "",
      }));
    } catch (error) {
      setTasks([]);
      setTodoFile("");
      setSelectedTaskId(null);
      setActiveRepoPath(nextRepoPath);
      setJobState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setIsLoadingTasks(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function fetchDefaultRepo() {
      try {
        const response = await fetch(`${API_BASE}/api/health`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load runner config.");
        }

        if (!active) {
          return;
        }

        setDefaultRepoPath(data.defaultRepoPath ?? "");
        setRepoPathInput(data.defaultRepoPath ?? "");
        loadTasks(data.defaultRepoPath ?? "");
      } catch (error) {
        if (!active) {
          return;
        }

        setJobState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    fetchDefaultRepo();

    return () => {
      active = false;
      streamRef.current?.close();
    };
  }, []);

  useEffect(() => {
    terminalRef.current?.scrollTo({
      top: terminalRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [jobState.logs]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  async function runTask(task) {
    if (!task) {
      return;
    }

    streamRef.current?.close();
    setJobState({
      status: "running",
      jobId: null,
      logs: "",
      error: "",
    });

    try {
      const response = await fetch(`${API_BASE}/api/tasks/${task.id}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: task.title,
          repoPath: activeRepoPath || defaultRepoPath,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to start task.");
      }

      setJobState((current) => ({
        ...current,
        jobId: data.jobId,
      }));

      const eventSource = new EventSource(`${API_BASE}/api/jobs/${data.jobId}/stream`);
      streamRef.current = eventSource;

      eventSource.onmessage = (event) => {
        const payload = JSON.parse(event.data);

        if (payload.type === "log") {
          setJobState((current) => ({
            ...current,
            logs: current.logs + payload.text,
          }));
          return;
        }

        if (payload.type === "done") {
          setJobState((current) => ({
            ...current,
            status: payload.status,
          }));
          eventSource.close();
          return;
        }
      };

      eventSource.onerror = () => {
        setJobState((current) => ({
          ...current,
          status: current.status === "running" ? "failed" : current.status,
          error: "SSE connection interrupted.",
        }));
        eventSource.close();
      };
    } catch (error) {
      setJobState({
        status: "failed",
        jobId: null,
        logs: "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Todo to Codex Runner</p>
          <h1>Parse `todo.md`, run one task, watch the terminal stream back live.</h1>
          <p className="lede">
            MVP for operating `codex exec` from a small web surface without opening the
            full-screen TUI.
          </p>
        </div>

        <div className="hero-meta">
          <div>
            <span className="meta-label">Tasks loaded</span>
            <strong>{tasks.length}</strong>
          </div>
          <div>
            <span className="meta-label">Runner state</span>
            <strong className={clsx("status-text", jobState.status)}>
              {jobState.status}
            </strong>
          </div>
          <div>
            <span className="meta-label">Default repo</span>
            <strong title={defaultRepoPath}>{defaultRepoPath || "Not configured"}</strong>
          </div>
        </div>
      </section>

      <section className="workspace">
        <div className="tasks-pane">
          <div className="pane-head">
            <div>
              <p className="pane-kicker">Task Queue</p>
              <h2>todo.md</h2>
            </div>
            <span className="pane-badge">{tasks.length} items</span>
          </div>

          <label className="field">
            <span>Repo path for `codex exec`</span>
            <input
              value={repoPathInput}
              onChange={(event) => setRepoPathInput(event.target.value)}
              placeholder="D:/sources/fe/projects/todoExample"
            />
          </label>

          <div className="field-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => loadTasks(repoPathInput)}
            >
              {isLoadingTasks ? "Loading..." : "Load todo.md"}
            </button>
            <span className="field-hint" title={todoFile}>
              {todoFile || "todo.md will be read from the selected repo path"}
            </span>
          </div>

          <div className="task-list">
            {tasks.map((task) => {
              const isSelected = task.id === selectedTaskId;

              return (
                <button
                  key={task.id}
                  type="button"
                  className={clsx("task-row", isSelected && "selected")}
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <span className="task-id">{task.id}</span>
                  <span className="task-title">{task.title}</span>
                  <span className={clsx("task-state", task.status)}>{task.status}</span>
                </button>
              );
            })}
          </div>

          <div className="task-action">
            <div>
              <p className="pane-kicker">Selected</p>
              <h3>{selectedTask ? `${selectedTask.id} ${selectedTask.title}` : "No task"}</h3>
            </div>
            <button
              type="button"
              className="run-button"
              onClick={() => runTask(selectedTask)}
              disabled={!selectedTask || jobState.status === "running"}
            >
              {jobState.status === "running" ? "Running..." : "Run task"}
            </button>
          </div>
        </div>

        <div className="terminal-pane">
          <div className="pane-head">
            <div>
              <p className="pane-kicker">Realtime Output</p>
              <h2>terminal stream</h2>
            </div>
            <span className={clsx("pane-badge", jobState.status)}>{jobState.status}</span>
          </div>

          <div className="terminal-meta">
            <span>jobId: {jobState.jobId ?? "not started"}</span>
            <span>repoPath: {activeRepoPath || defaultRepoPath || "not set"}</span>
          </div>

          <pre ref={terminalRef} className="terminal-output">
            {jobState.logs || "Press Run task to start streaming Codex output.\n"}
          </pre>

          {jobState.error ? <p className="error-text">{jobState.error}</p> : null}
        </div>
      </section>
    </main>
  );
}
