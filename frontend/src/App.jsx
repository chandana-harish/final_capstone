import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = "";
const AUTH_BASE = "";

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

async function auth(path, options = {}) {
  const response = await fetch(`${AUTH_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function StatusPill({ value }) {
  const className = `pill ${value || "unknown"}`;
  return <span className={className}>{value || "unknown"}</span>;
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-icon">CI</div>
      <h2>No pipeline running</h2>
      <p>Select a repository, workflow, and branch, then start the GitHub Actions workflow from PipelineIQ.</p>
    </div>
  );
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function FixCard({ fix }) {
  return (
    <div className="fix-card">
      <div className="fix-card-top">
        <span className="fix-type">{fix.type || "fix"}</span>
        <h4>{fix.title || "Suggested fix"}</h4>
      </div>
      <p>{fix.details}</p>
      {fix.steps?.length > 0 && (
        <ol className="fix-steps">
          {fix.steps.map((step, index) => (
            <li key={`${fix.title || "step"}-${index}`}>{step}</li>
          ))}
        </ol>
      )}
      {fix.files?.length > 0 && (
        <div className="file-list">
          {fix.files.map((file) => <span key={file}>{file}</span>)}
        </div>
      )}
    </div>
  );
}

function Login() {
  return (
    <main className="login-shell">
      <section className="login-panel">
        <div>
          <p className="eyebrow">PipelineIQ</p>
          <h1>AI Powered Pipeline Intelligence</h1>
          <p className="login-copy">Trigger real workflows, watch their status, and turn failed logs into clear remediation steps.</p>
        </div>
        <a className="primary-action" href={`${AUTH_BASE}/api/auth/github`}>
          Login with GitHub
        </a>
      </section>
    </main>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [repos, setRepos] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [currentRun, setCurrentRun] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysisRefresh, setAnalysisRefresh] = useState(0);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.id === selectedRepoId),
    [repos, selectedRepoId]
  );
  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => String(workflow.id) === selectedWorkflowId),
    [workflows, selectedWorkflowId]
  );
  const suggestedFixes = useMemo(() => asArray(analysis?.suggested_fixes), [analysis]);
  const affectedFiles = useMemo(() => asArray(analysis?.affected_files), [analysis]);

  useEffect(() => {
    auth("/api/auth/me")
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([api("/api/repos"), api("/api/dashboard/summary")])
      .then(([repoData, summaryData]) => {
        setRepos(repoData.repositories || []);
        setSummary(summaryData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!selectedRepo) return;
    setWorkflows([]);
    setBranches([]);
    setSelectedWorkflowId("");
    setSelectedBranch("");
    Promise.all([
      api(`/api/repos/${selectedRepo.owner}/${selectedRepo.name}/workflows`),
      api(`/api/repos/${selectedRepo.owner}/${selectedRepo.name}/branches`)
    ])
      .then(([workflowData, branchData]) => {
        setWorkflows(workflowData.workflows || []);
        setBranches(branchData.branches || []);
        setSelectedBranch(selectedRepo.default_branch || branchData.branches?.[0]?.name || "");
      })
      .catch((err) => setError(err.message));
  }, [selectedRepo]);

  useEffect(() => {
    if (!currentRun?.id) return;
    const interval = setInterval(async () => {
      try {
        const data = await api(`/api/pipeline-runs/${currentRun.id}`);
        setCurrentRun(data.pipelineRun);
        setAnalysis(data.analysis);
        const terminalSuccess = data.pipelineRun.status === "completed" && data.pipelineRun.conclusion !== "failure";
        const failedRunWithAnalysis = data.pipelineRun.conclusion === "failure" && data.analysis?.failure_reason;
        if (terminalSuccess || failedRunWithAnalysis || data.pipelineRun.status === "monitor_timeout") {
          clearInterval(interval);
        }
      } catch (err) {
        setError(err.message);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [currentRun?.id, analysisRefresh]);

  async function runPipeline() {
    if (!selectedRepo || !selectedWorkflowId || !selectedBranch) return;
    setLoading(true);
    setError("");
    setAnalysis(null);
    try {
      const data = await api(`/api/repos/${selectedRepo.owner}/${selectedRepo.name}/workflows/${selectedWorkflowId}/run`, {
        method: "POST",
        body: JSON.stringify({
          branch: selectedBranch,
          workflowName: selectedWorkflow?.name,
          repositoryId: selectedRepo.id
        })
      });
      setCurrentRun(data.pipelineRun);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function retryAnalysis() {
    if (!currentRun?.id) return;
    setLoading(true);
    setError("");
    try {
      await api(`/api/pipeline-runs/${currentRun.id}/analyze`, { method: "POST" });
      setAnalysis(null);
      setAnalysisRefresh((value) => value + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await auth("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  if (!user) return <Login />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PipelineIQ</p>
          <h1>AI Powered Pipeline Intelligence</h1>
          <p className="page-subtitle">Launch workflows, track failures, and turn broken runs into clear fixes.</p>
        </div>
        <div className="user-strip">
          {user.avatar_url && <img src={user.avatar_url} alt="" />}
          <span>{user.username}</span>
          <button className="ghost-button" onClick={logout}>Logout</button>
        </div>
      </header>

      {error && <div className="alert">{error}</div>}

      <section className="summary-grid">
        <div className="metric">
          <span>Total Runs</span>
          <strong>{summary?.summary?.total_runs ?? 0}</strong>
        </div>
        <div className="metric success-metric">
          <span>Passed</span>
          <strong>{summary?.summary?.passed_runs ?? 0}</strong>
        </div>
        <div className="metric failed-metric">
          <span>Failed</span>
          <strong>{summary?.summary?.failed_runs ?? 0}</strong>
        </div>
      </section>

      <section className="workspace">
        <div className="control-panel">
          <div className="section-heading">
            <h2>Run Pipeline</h2>
            <p>Choose the exact GitHub Actions workflow to dispatch.</p>
          </div>
          <label>
            Repository
            <select value={selectedRepoId} onChange={(event) => setSelectedRepoId(event.target.value)}>
              <option value="">Select repository</option>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>{repo.full_name}</option>
              ))}
            </select>
          </label>

          <label>
            Workflow
            <select value={selectedWorkflowId} onChange={(event) => setSelectedWorkflowId(event.target.value)} disabled={!workflows.length}>
              <option value="">Select workflow</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
              ))}
            </select>
          </label>

          <label>
            Branch
            <select value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} disabled={!branches.length}>
              <option value="">Select branch</option>
              {branches.map((branch) => (
                <option key={branch.name} value={branch.name}>{branch.name}</option>
              ))}
            </select>
          </label>

          <button className="primary-action" disabled={loading || !selectedRepo || !selectedWorkflowId || !selectedBranch} onClick={runPipeline}>
            {loading ? "Starting..." : "Run Pipeline"}
          </button>
        </div>

        <div className="run-panel">
          <div className="panel-heading">
            <h2>Current Run</h2>
            {currentRun && <StatusPill value={currentRun.conclusion || currentRun.status} />}
          </div>

          {!currentRun && <EmptyState />}

          {currentRun && (
            <dl className="details">
              <div><dt>Repository</dt><dd>{currentRun.owner}/{currentRun.repo}</dd></div>
              <div><dt>Workflow</dt><dd>{currentRun.workflow_name || currentRun.workflow_id}</dd></div>
              <div><dt>Branch</dt><dd>{currentRun.branch}</dd></div>
              <div><dt>GitHub Run</dt><dd>{currentRun.github_run_id || "Waiting for GitHub run id"}</dd></div>
            </dl>
          )}

          {currentRun?.conclusion === "failure" && (
            <div className="action-row">
              <button className="secondary-action" disabled={loading} onClick={retryAnalysis}>
                {loading ? "Queuing..." : "Retry Analysis"}
              </button>
            </div>
          )}

          {analysis?.failure_reason && (
            <div className="analysis">
              <h2>Failure Analysis</h2>
              <dl className="details compact">
                <div><dt>Failed Job</dt><dd>{analysis.failed_job || "Unknown"}</dd></div>
                <div><dt>Failed Step</dt><dd>{analysis.failed_step || "Unknown"}</dd></div>
                <div><dt>Category</dt><dd>{analysis.category || "Unknown"}</dd></div>
              </dl>
              <div className="analysis-detail">
                <h2>AI Recommendation</h2>
              <div className="risk-row">
                <span>Risk Score</span>
                <strong>{analysis.risk_score}/100</strong>
                <span className="confidence-label">Confidence</span>
                <StatusPill value={analysis.confidence_level} />
              </div>
              <h3>{analysis.failure_reason}</h3>
              <p>{analysis.explanation}</p>
              {analysis.possible_root_cause && (
                <>
                  <h3>Possible Root Cause</h3>
                  <p>{analysis.possible_root_cause}</p>
                </>
              )}
              <h3>Recommended Fixes</h3>
              {suggestedFixes.length > 0 ? (
                <div className="fix-grid">
                  {suggestedFixes.map((fix, index) => <FixCard key={`${fix.title || "fix"}-${index}`} fix={fix} />)}
                </div>
              ) : (
                <p>{analysis.suggested_fix}</p>
              )}
              {affectedFiles.length > 0 && (
                <>
                  <h3>Affected Files</h3>
                  <div className="file-list large">
                    {affectedFiles.map((file) => <span key={file}>{file}</span>)}
                  </div>
                </>
              )}
              </div>
            </div>
          )}

          {currentRun?.conclusion === "failure" && !analysis?.failure_reason && (
            <div className="analysis pending">
              <h2>Failure Analysis</h2>
              <p>PipelineIQ detected the failed run. Gemini is preparing the failure cause and suggested fix.</p>
              {analysis?.category && (
                <dl className="details compact">
                  <div><dt>Failed Job</dt><dd>{analysis.failed_job || "Unknown"}</dd></div>
                  <div><dt>Failed Step</dt><dd>{analysis.failed_step || "Unknown"}</dd></div>
                  <div><dt>Category</dt><dd>{analysis.category}</dd></div>
                </dl>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
