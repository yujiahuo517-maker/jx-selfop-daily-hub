-- 自营作业完成看板：上报记录（一行一条，按 updated_at 取最新）
CREATE TABLE IF NOT EXISTS reports (
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  task_id TEXT NOT NULL,
  erp TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date);
CREATE INDEX IF NOT EXISTS idx_reports_lookup ON reports(date, task_id, erp);
