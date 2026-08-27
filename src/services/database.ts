/**
 * V4.x expo-sqlite 数据库封装 (08-25 老板拍板 B 方案: 接入 S3 expo-sqlite)
 *
 * 实战反证金标准:
 *   - V2.x V22.x 用 op-sqlite + 27 张表
 *   - V4.x S2.2 阶段先 mock, S3 业务增强接入 expo-sqlite
 *   - 当前实现: expo-sqlite 16.0.10 + 单表 reports (千机端写库)
 *
 * 数据流:
 *   CustomerInfo (from qianji.ts step4)
 *     ↓ writeReport(customer, projectNameOverride?)
 *   reports 表 (id, customer_name, phone, project_name, project_type, status, created_at)
 *
 * 保利双写 (08-25 老板拍板文档实战反证金标准):
 *   - 保利缦城和颂 + 保利山水和颂 = 2 条记录, 2 个 ID
 *   - 其他客户类型 (越秀/招商) 只写 1 条
 */

import * as SQLite from 'expo-sqlite';
import type { CustomerInfo } from '@/flow/qianji';

let _db: SQLite.SQLiteDatabase | null = null;
let _initialized = false;

/**
 * 打开 + 初始化 reports 表 (08-25)
 */
async function ensureDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db && _initialized) return _db;

  _db = await SQLite.openDatabaseAsync('zbb.db');
  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_gender TEXT,
      phone TEXT NOT NULL,
      phone_part1 TEXT,
      phone_part2 TEXT,
      phone_part3 TEXT,
      phone_last4 TEXT,
      company_name TEXT,
      property_type TEXT,
      project_name TEXT NOT NULL,
      project_type TEXT NOT NULL,
      report_time TEXT,
      expected_visit_time TEXT,
      agent TEXT,
      agent_phone TEXT,
      agent_note TEXT,
      city TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);
  _initialized = true;
  console.log('[database] expo-sqlite reports 表已初始化');
  return _db;
}

/**
 * 写 1 条客户记录到 reports 表
 */
export async function writeReport(
  customer: CustomerInfo,
  projectNameOverride?: string,
): Promise<number> {
  const db = await ensureDb();
  const projectName = projectNameOverride || customer.projectName;
  const result = await db.runAsync(
    `INSERT INTO reports (
      customer_name, customer_gender, phone, phone_part1, phone_part2, phone_part3, phone_last4,
      company_name, property_type, project_name, project_type,
      report_time, expected_visit_time, agent, agent_phone, agent_note, city
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    customer.customerName,
    customer.customerGender,
    customer.phone,
    customer.phonePart1,
    customer.phonePart2,
    customer.phonePart3,
    customer.phoneLast4,
    customer.companyName,
    customer.propertyType,
    projectName,
    customer.projectType,
    customer.reportTime,
    customer.expectedVisitTime,
    customer.agent,
    customer.agentPhone,
    customer.agentNote,
    customer.city,
  );
  console.log(`[database] 写入 reports ID=${result.lastInsertRowId}, 客户=${customer.customerName}, 项目=${projectName}`);
  return result.lastInsertRowId ?? 0;
}

/**
 * 保利双写 (08-25 老板拍板文档实战反证金标准)
 *
 * 保利项目需写 2 条数据:
 *   - "保利缦城和颂" (round 1)
 *   - "保利山水和颂" (round 2)
 * 其他客户类型 (越秀/招商) 走单写 writeReport
 *
 * @returns [id1, id2] 两个新插入的 ID
 */
export async function writeBaoliDouble(
  customer: CustomerInfo,
  project1Name = '保利缦城和颂',
  project2Name = '保利山水和颂',
): Promise<[number, number]> {
  if (customer.projectType !== 'baoli') {
    console.warn(`[database] writeBaoliDouble 调用但 projectType=${customer.projectType}, 走单写`);
    const id = await writeReport(customer);
    return [id, 0];
  }
  const id1 = await writeReport(customer, project1Name);
  const id2 = await writeReport(customer, project2Name);
  console.log(`[database] 保利双写完成: ID1=${id1}(${project1Name}) + ID2=${id2}(${project2Name})`);
  return [id1, id2];
}

/**
 * 按 ID 查询 report (用于后续保理/越秀端读取)
 */
export async function getReportById(id: number): Promise<any | null> {
  const db = await ensureDb();
  const row = await db.getFirstAsync(`SELECT * FROM reports WHERE id = ?`, id);
  return row;
}

/**
 * 列出 pending 状态的所有报告 (按 id ASC)
 */
export async function getPendingReports(projectType?: string): Promise<any[]> {
  const db = await ensureDb();
  const query = projectType
    ? `SELECT * FROM reports WHERE status='pending' AND project_type=? ORDER BY id ASC`
    : `SELECT * FROM reports WHERE status='pending' ORDER BY id ASC`;
  const params = projectType ? [projectType] : [];
  return db.getAllAsync(query, ...params);
}

/**
 * 🆕 08-26 老板实战要求: 查数据库最近 N 条记录 (按 id DESC)
 *   步骤 4 末尾打印, 实战双写是否真的写了 2 条
 */
export async function getRecentReports(limit: number = 3): Promise<any[]> {
  const db = await ensureDb();
  return db.getAllAsync(`SELECT * FROM reports ORDER BY id DESC LIMIT ?`, limit);
}

/**
 * 标记 report 完成
 */
export async function markReportDone(id: number, status: 'done' | 'failed' = 'done'): Promise<void> {
  const db = await ensureDb();
  await db.runAsync(`UPDATE reports SET status=? WHERE id=?`, status, id);
}