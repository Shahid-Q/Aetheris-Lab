CREATE TABLE IF NOT EXISTS public_requests (
  id TEXT NOT NULL PRIMARY KEY,
  input_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'Submitted'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Check the column contract if the table was already provisioned outside the repository.
SELECT id, input_json, status, created_at, updated_at FROM public_requests LIMIT 0;

CREATE TABLE public_request_tokens (
  request_id TEXT NOT NULL PRIMARY KEY REFERENCES public_requests(id) ON DELETE CASCADE,
  token_sha256 TEXT NOT NULL CHECK (
    length(token_sha256) = 64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'
  )
);
