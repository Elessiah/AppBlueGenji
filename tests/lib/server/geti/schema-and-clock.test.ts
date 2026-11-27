import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { DECLARED_TABLES } from "@/lib/server/database/declared-tables";
import { createGetiTables } from "@/lib/server/database/schema/geti";
import { mockPlanningClocks, type PlanningClockMocks } from "../../../helpers/instrumentation-clocks";
import { fakePool, type SqlQuery } from "../../../helpers/sql-double";

/** Table `bg_geti_posts` et lancement de sa purge au démarrage du serveur. */

type InstrumentationModule = typeof import("@/instrumentation");

describe("createGetiTables", () => {
  beforeEach(() => {
    DECLARED_TABLES.length = 0;
  });

  it("createGetiTables_called_declaresThePostsTableWithItsKeys", async () => {
    const execute = jest.fn<SqlQuery>(async () => [{}]);

    await createGetiTables(fakePool({ execute }));

    const ddl = String(execute.mock.calls[0][0]);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS bg_geti_posts");
    expect(ddl).toContain("UNIQUE KEY uniq_bg_geti_posts_message (message_id)");
    expect(ddl).toContain("KEY idx_bg_geti_posts_category (category, posted_at)");
    expect(ddl).toContain("KEY idx_bg_geti_posts_posted (posted_at)");
    expect(DECLARED_TABLES).toHaveLength(4);
  });

  it("createGetiTables_called_declaresTheObjectionsTableUniquePerTarget", async () => {
    const execute = jest.fn<SqlQuery>(async () => [{}]);

    await createGetiTables(fakePool({ execute }));

    const ddl = String(execute.mock.calls[1][0]);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS bg_geti_objections");
    expect(ddl).toContain("UNIQUE KEY uniq_bg_geti_objections_target (kind, target_id)");
  });

  it("createGetiTables_called_cascadesAlertTracesWithTheirAlert", async () => {
    const execute = jest.fn<SqlQuery>(async () => [{}]);

    await createGetiTables(fakePool({ execute }));

    const ddl = String(execute.mock.calls[3][0]);
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS bg_geti_alert_hits");
    expect(ddl).toContain("REFERENCES bg_geti_alerts(id) ON DELETE CASCADE");
  });

  it("createGetiTables_creationRefused_doesNotThrow", async () => {
    const execute = jest.fn<SqlQuery>(async () => {
      throw new Error("CREATE command denied");
    });

    await expect(createGetiTables(fakePool({ execute }))).resolves.toBeUndefined();
  });
});

describe("register — purge des annonces GETI", () => {
  const saved = { runtime: process.env.NEXT_RUNTIME, phase: process.env.NEXT_PHASE };
  let clocks: PlanningClockMocks;

  function loadInstrumentation(): InstrumentationModule {
    const loaded: InstrumentationModule[] = [];
    jest.resetModules();
    jest.isolateModules(() => {
      clocks = mockPlanningClocks();
      jest.doMock("@/lib/server/bot-log-shutdown", () => ({ installBotLogShutdownFlush: jest.fn() }));
      jest.doMock("@/lib/server/audience-service", () => ({ startAudienceMaintenanceClock: jest.fn() }));
      loaded.push(jest.requireActual<InstrumentationModule>("@/instrumentation"));
    });
    return loaded[0];
  }

  beforeEach(() => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
  });

  afterEach(() => {
    if (saved.runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = saved.runtime;
    if (saved.phase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = saved.phase;
  });

  it("register_serverRuntime_startsTheGetiPurgeClock", async () => {
    await loadInstrumentation().register();

    expect(clocks.getiPurge).toHaveBeenCalledTimes(1);
  });

  it("register_productionBuildPhase_doesNotStartTheGetiPurgeClock", async () => {
    process.env.NEXT_PHASE = "phase-production-build";

    await loadInstrumentation().register();

    expect(clocks.getiPurge).not.toHaveBeenCalled();
  });

  it("register_getiPurgeClockThrows_stillResolves", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const instrumentation = loadInstrumentation();
    clocks.getiPurge.mockImplementation(() => {
      throw new Error("horloge en panne");
    });

    await expect(instrumentation.register()).resolves.toBeUndefined();
    logged.mockRestore();
  });
});
