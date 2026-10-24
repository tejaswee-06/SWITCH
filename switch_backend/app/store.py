"""SQLite persistence (stdlib) with ordered migrations and explicit transactions.
Durable when a file path is used; ':memory:' is for tests only."""
import json, sqlite3, threading
from contextlib import contextmanager
from datetime import datetime, timezone

MIGRATIONS = [
("001_initial", """
CREATE TABLE households (household_id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE users (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, household_id TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE routines (household_id TEXT NOT NULL, routine_id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL,
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, PRIMARY KEY (household_id, routine_id, version));
CREATE TABLE scenarios (household_id TEXT NOT NULL, scenario_id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (household_id, scenario_id, version));
CREATE TABLE requirements (requirement_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, current_version INTEGER NOT NULL,
  status TEXT NOT NULL, confirmation TEXT, last_result TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE requirement_versions (requirement_id TEXT NOT NULL, version INTEGER NOT NULL, content TEXT NOT NULL,
  changed_by TEXT NOT NULL, changed_at TEXT NOT NULL, note TEXT, PRIMARY KEY (requirement_id, version));
CREATE TABLE candidates (candidate_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, routine_id TEXT NOT NULL,
  base_version INTEGER NOT NULL, version INTEGER NOT NULL, parent_candidate_id TEXT, routine TEXT NOT NULL, repair TEXT,
  repair_source TEXT, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (household_id, routine_id, version));
CREATE TABLE replays (run_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, candidate_id TEXT NOT NULL, kind TEXT NOT NULL,
  overall TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE approvals (approval_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, candidate_id TEXT NOT NULL, run_id TEXT,
  decision TEXT NOT NULL, note TEXT, decided_by TEXT NOT NULL, decided_at TEXT NOT NULL);
CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, household_id TEXT, actor TEXT, action TEXT NOT NULL,
  entity_type TEXT, entity_id TEXT, detail TEXT, at TEXT NOT NULL);
"""),
("002_integrity", """
CREATE INDEX idx_req_hh ON requirements (household_id);
CREATE INDEX idx_cand_hh ON candidates (household_id, routine_id);
CREATE INDEX idx_replay_cand ON replays (household_id, candidate_id, created_at);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE TRIGGER requirement_versions_immutable BEFORE UPDATE ON requirement_versions BEGIN SELECT RAISE(ABORT, 'requirement_versions is append-only'); END;
CREATE TRIGGER replays_immutable BEFORE UPDATE ON replays BEGIN SELECT RAISE(ABORT, 'replays is append-only'); END;
CREATE TRIGGER approvals_immutable BEFORE UPDATE ON approvals BEGIN SELECT RAISE(ABORT, 'approvals is append-only'); END;
CREATE TRIGGER audit_immutable BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER routines_immutable BEFORE UPDATE ON routines BEGIN SELECT RAISE(ABORT, 'routine versions are immutable'); END;
CREATE TRIGGER scenarios_immutable BEFORE UPDATE ON scenarios BEGIN SELECT RAISE(ABORT, 'scenario versions are immutable'); END;
"""),
("003_repair_provenance", """
ALTER TABLE candidates ADD COLUMN repair_provenance TEXT;
"""),
]

CANDIDATE_COLS = ("candidate_id", "household_id", "routine_id", "base_version", "version", "parent_candidate_id",
                  "routine", "repair", "repair_source", "status", "created_by", "created_at", "repair_provenance")
INSERT_CANDIDATE = f"INSERT INTO candidates ({','.join(CANDIDATE_COLS)}) VALUES ({','.join('?' * len(CANDIDATE_COLS))})"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: str = ":memory:"):
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self._depth = 0
        self.migrate()

    def migrate(self):
        with self.lock:
            self.conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT)")
            done = {r["name"] for r in self.conn.execute("SELECT name FROM schema_migrations")}
            for name, sql in MIGRATIONS:
                if name not in done:
                    self.conn.executescript("BEGIN;" + sql + f"INSERT INTO schema_migrations VALUES ('{name}','{now()}');COMMIT;")

    @contextmanager
    def tx(self):
        with self.lock:
            outer = self._depth == 0
            if outer:
                self.conn.execute("BEGIN IMMEDIATE")
            self._depth += 1
            try:
                yield self
                self._depth -= 1
                if outer:
                    self.conn.execute("COMMIT")
            except BaseException:
                self._depth -= 1
                if outer:
                    self.conn.execute("ROLLBACK")
                raise

    def run(self, sql, params=()):
        with self.lock:
            return self.conn.execute(sql, params)

    def one(self, sql, params=()):
        with self.lock:
            r = self.conn.execute(sql, params).fetchone()
            return dict(r) if r else None

    def all(self, sql, params=()):
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def audit(self, household_id, actor, action, entity_type, entity_id, detail=None):
        self.run("INSERT INTO audit_log (household_id,actor,action,entity_type,entity_id,detail,at) VALUES (?,?,?,?,?,?,?)",
                 (household_id, actor, action, entity_type, entity_id, json.dumps(detail or {}), now()))

    def wipe_households(self, household_ids):
        """Delete ONLY the given households' rows (demo reset). Other households are untouched."""
        ids = tuple(household_ids)
        ph = ",".join("?" * len(ids))
        with self.tx():
            self.run(f"DELETE FROM requirement_versions WHERE requirement_id IN (SELECT requirement_id FROM requirements WHERE household_id IN ({ph}))", ids)
            for t in ("approvals", "replays", "candidates", "requirements", "scenarios", "routines", "users", "audit_log"):
                self.run(f"DELETE FROM {t} WHERE household_id IN ({ph})", ids)
            self.run(f"DELETE FROM households WHERE household_id IN ({ph})", ids)
