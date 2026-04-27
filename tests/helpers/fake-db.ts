import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

type TableName = "bg_users" | "bg_tournaments" | "bg_tournament_registrations" | "bg_matches";

interface FakePool {
  execute: jest.Mock<any>;
  getConnection: jest.Mock<any>;
}

export class FakeDatabase {
  private tables: Map<TableName, Map<string, any>> = new Map();

  constructor() {
    this.tables.set("bg_users", new Map());
    this.tables.set("bg_tournaments", new Map());
    this.tables.set("bg_tournament_registrations", new Map());
    this.tables.set("bg_matches", new Map());
  }

  insertUser(user: any): void {
    const users = this.tables.get("bg_users")!;
    const id = users.size + 1;
    users.set(id.toString(), { ...user, id });
  }

  insertTournament(tournament: any): void {
    const tournaments = this.tables.get("bg_tournaments")!;
    const id = tournaments.size + 1;
    tournaments.set(id.toString(), { ...tournament, id });
  }

  insertRegistration(registration: any): void {
    const registrations = this.tables.get("bg_tournament_registrations")!;
    const key = `${registration.tournament_id}-${registration.team_id}`;
    registrations.set(key, registration);
  }

  insertMatch(match: any): void {
    const matches = this.tables.get("bg_matches")!;
    const id = matches.size + 1;
    matches.set(id.toString(), { ...match, id });
  }

  getTournament(id: number): any {
    return this.tables.get("bg_tournaments")!.get(id.toString());
  }

  getMatch(id: number): any {
    return this.tables.get("bg_matches")!.get(id.toString());
  }

  createMockPool(): FakePool {
    return {
      execute: jest.fn(async (sql: string, params?: any[]) => {
        return this.executeSql(sql, params);
      }),
      getConnection: jest.fn(async () => ({
        execute: jest.fn(async (sql: string, params?: any[]) => {
          return this.executeSql(sql, params);
        }),
        release: jest.fn(),
      })),
    };
  }

  private async executeSql(sql: string, params?: any[]): Promise<[any[], any]> {
    // Simplified SQL execution - expand as needed for tests
    const lowerSql = sql.toLowerCase();

    if (lowerSql.includes("select count")) {
      return [[{ c: 0 }], undefined];
    }

    if (lowerSql.includes("insert")) {
      return [{}, undefined];
    }

    if (lowerSql.includes("update")) {
      return [{ affectedRows: 1 }, undefined];
    }

    if (lowerSql.includes("delete")) {
      return [{}, undefined];
    }

    return [[], undefined];
  }
}
