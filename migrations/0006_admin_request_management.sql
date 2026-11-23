ALTER TABLE public_request_workflow ADD COLUMN archived_at TEXT;

CREATE TABLE public_request_management_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('archive', 'restore', 'delete')),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX public_management_delete ON public_request_management_events(request_id)
WHERE action = 'delete';

CREATE TABLE public_request_image_deletions (
  object_key TEXT NOT NULL PRIMARY KEY,
  queued_at TEXT NOT NULL
);

CREATE TRIGGER public_management_no_update BEFORE UPDATE ON public_request_management_events
BEGIN SELECT RAISE(ABORT, 'Management history is append-only'); END;

CREATE TRIGGER public_management_no_delete BEFORE DELETE ON public_request_management_events
BEGIN SELECT RAISE(ABORT, 'Management history is append-only'); END;

DROP TRIGGER public_history_no_delete;
CREATE TRIGGER public_history_no_delete BEFORE DELETE ON public_request_status_history
WHEN NOT EXISTS (
  SELECT 1 FROM public_request_management_events WHERE request_id = OLD.request_id AND action = 'delete'
)
BEGIN SELECT RAISE(ABORT, 'Status history is append-only'); END;

DROP TRIGGER public_decision_no_delete;
CREATE TRIGGER public_decision_no_delete BEFORE DELETE ON public_review_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM public_request_management_events WHERE request_id = OLD.request_id AND action = 'delete'
)
BEGIN SELECT RAISE(ABORT, 'Review decisions are append-only'); END;

CREATE TRIGGER public_manage_archive AFTER INSERT ON public_request_management_events
WHEN NEW.action IN ('archive', 'restore')
BEGIN
  UPDATE public_request_workflow
  SET archived_at = CASE WHEN NEW.action = 'archive' THEN NEW.created_at ELSE NULL END
  WHERE request_id = NEW.request_id;
END;

-- Purge the request and revoke its receipt atomically. R2 deletion is retried separately.
CREATE TRIGGER public_manage_delete AFTER INSERT ON public_request_management_events
WHEN NEW.action = 'delete'
BEGIN
  INSERT INTO public_request_image_deletions (object_key, queued_at)
  SELECT object_key, NEW.created_at FROM public_request_images WHERE request_id = NEW.request_id;
  DELETE FROM public_request_images WHERE request_id = NEW.request_id;
  DELETE FROM public_review_decisions WHERE request_id = NEW.request_id;
  DELETE FROM public_request_status_history WHERE request_id = NEW.request_id;
  DELETE FROM public_assessment_evidence WHERE run_id IN (
    SELECT id FROM public_agent_runs WHERE request_id = NEW.request_id
  );
  DELETE FROM public_assessment_drafts WHERE run_id IN (
    SELECT id FROM public_agent_runs WHERE request_id = NEW.request_id
  );
  DELETE FROM public_agent_runs WHERE request_id = NEW.request_id;
  DELETE FROM public_request_workflow WHERE request_id = NEW.request_id;
  DELETE FROM public_request_tokens WHERE request_id = NEW.request_id;
  DELETE FROM public_requests WHERE id = NEW.request_id;
END;
