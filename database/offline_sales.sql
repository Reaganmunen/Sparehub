-- Offline sales: remembers every sale a till uploaded after working without internet,
-- so an upload that is retried (bad signal, two tabs, a double click) can never record the same sale twice.
-- The server also creates this table by itself the first time it is needed, so running this file is optional.
-- Run it on Supabase / Neon too if you move the schema by hand.

CREATE TABLE IF NOT EXISTS offline_sales (
  client_ref    text PRIMARY KEY,                 -- unique id made on the till when the sale was taken
  sale_id       integer,                          -- the sale it became on the server
  receipt_no    text,                             -- the real receipt number the server gave it
  offline_label text,                             -- the temporary number printed on the offline receipt, e.g. OFF-BB-A7K2-0012
  branch_id     integer NOT NULL,
  user_id       integer NOT NULL,                 -- who uploaded it
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offline_sales_label ON offline_sales (offline_label);
