/**
 * V4.x flow barrel export (老板实战反证金标准 08-23)
 * 把 qianji / baoli 流程的入口函数集中再导出, 让 HomeScreen 一行 import 即可
 */

export { runQianjiFlow, stepOpenQianji, stepRecognizeInterface, stepFindReportReview, stepParseCustomerInfo, stepWriteToReports, stepCopyPhoneNumber } from './qianji';
export type { CustomerInfo } from './qianji';

export { runBaoliFlow } from './baoli';