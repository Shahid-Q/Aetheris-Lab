-- Phase 3 receipts and token hashes stay in their original tables.
CREATE TABLE public_request_workflow (
  request_id TEXT PRIMARY KEY REFERENCES public_requests(id),
  status TEXT NOT NULL CHECK (status IN (
    'Submitted', 'Analyzing', 'Pending Review', 'Approved', 'Rejected', 'Needs More Information'
  )),
  updated_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  run_id TEXT
);

CREATE INDEX public_requests_created ON public_requests(created_at, id);
CREATE INDEX public_workflow_queue ON public_request_workflow(status, updated_at, request_id);

CREATE TABLE public_agent_runs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES public_request_workflow(request_id),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'unconfigured', 'failed')),
  started_at TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  finished_at TEXT,
  failure_code TEXT,
  provider TEXT,
  model TEXT,
  UNIQUE (request_id, id)
);

CREATE UNIQUE INDEX public_agent_single_run ON public_agent_runs(request_id) WHERE status = 'running';
CREATE INDEX public_agent_leases ON public_agent_runs(lease_until) WHERE status = 'running';

CREATE TABLE public_assessment_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public_agent_runs(id),
  source TEXT NOT NULL CHECK (source IN ('PubChem', 'NIOSH')),
  kind TEXT NOT NULL CHECK (kind IN ('identity', 'hazard', 'incompatibility')),
  solution TEXT NOT NULL CHECK (solution IN ('A', 'B')),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  retrieved_at TEXT NOT NULL
);

CREATE INDEX public_evidence_run ON public_assessment_evidence(run_id, id);

CREATE TABLE public_assessment_drafts (
  run_id TEXT PRIMARY KEY REFERENCES public_agent_runs(id),
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE public_review_decisions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('Approved', 'Rejected', 'Needs More Information')),
  notes TEXT NOT NULL,
  approved_result_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (request_id, run_id) REFERENCES public_agent_runs(request_id, id),
  CHECK ((decision = 'Approved') = (approved_result_json IS NOT NULL))
);

CREATE TABLE public_request_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES public_request_workflow(request_id),
  status TEXT NOT NULL,
  actor TEXT NOT NULL,
  run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX public_history_request ON public_request_status_history(request_id, id);

CREATE TABLE public_request_images (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES public_requests(id),
  solution TEXT NOT NULL CHECK (solution IN ('A', 'B')),
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  UNIQUE (request_id, solution)
);

CREATE TRIGGER public_workflow_initial_history AFTER INSERT ON public_request_workflow
BEGIN
  INSERT INTO public_request_status_history (request_id, status, actor, created_at)
  VALUES (NEW.request_id, NEW.status, NEW.actor, NEW.updated_at);
END;

CREATE TRIGGER public_workflow_history AFTER UPDATE OF status ON public_request_workflow
WHEN OLD.status != NEW.status
BEGIN
  INSERT INTO public_request_status_history (request_id, status, actor, run_id, created_at)
  VALUES (NEW.request_id, NEW.status, NEW.actor, COALESCE(NEW.run_id, OLD.run_id), NEW.updated_at);
END;

CREATE TRIGGER public_request_queue AFTER INSERT ON public_requests
BEGIN
  INSERT INTO public_request_workflow (request_id, status, updated_at, actor)
  VALUES (NEW.id, 'Submitted', NEW.created_at, 'requester');
END;

-- A mixed-version rollout can continue to accept Phase 3 submissions.
INSERT INTO public_request_workflow (request_id, status, updated_at, actor)
SELECT id, 'Submitted', created_at, 'requester' FROM public_requests;

CREATE TRIGGER public_run_start AFTER INSERT ON public_agent_runs
BEGIN
  UPDATE public_request_workflow
  SET status = 'Analyzing', updated_at = NEW.started_at, actor = 'agent', run_id = NEW.id
  WHERE request_id = NEW.request_id;
END;

CREATE TRIGGER public_run_finish AFTER UPDATE OF status ON public_agent_runs
WHEN OLD.status = 'running' AND NEW.status != 'running'
BEGIN
  UPDATE public_request_workflow
  SET status = 'Pending Review', updated_at = NEW.finished_at, actor = 'agent'
  WHERE request_id = NEW.request_id AND run_id = NEW.id AND status = 'Analyzing';
END;

CREATE TRIGGER public_review_finish AFTER INSERT ON public_review_decisions
BEGIN
  UPDATE public_request_workflow
  SET status = NEW.decision, updated_at = NEW.created_at, actor = NEW.reviewer_id
  WHERE request_id = NEW.request_id AND run_id = NEW.run_id AND status = 'Pending Review';
END;

CREATE TRIGGER public_history_no_update BEFORE UPDATE ON public_request_status_history
BEGIN SELECT RAISE(ABORT, 'Status history is append-only'); END;

CREATE TRIGGER public_history_no_delete BEFORE DELETE ON public_request_status_history
BEGIN SELECT RAISE(ABORT, 'Status history is append-only'); END;

CREATE TRIGGER public_decision_no_update BEFORE UPDATE ON public_review_decisions
BEGIN SELECT RAISE(ABORT, 'Review decisions are append-only'); END;

CREATE TRIGGER public_decision_no_delete BEFORE DELETE ON public_review_decisions
BEGIN SELECT RAISE(ABORT, 'Review decisions are append-only'); END;
