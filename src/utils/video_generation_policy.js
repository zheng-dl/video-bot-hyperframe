/**
 * 将前端传入的百分比语速配置转换为 TTS 可识别的倍速值
 */
export function normalizeTtsRate(speed = '0') {
  const numericSpeed = Number.parseFloat(speed);
  if (Number.isNaN(numericSpeed)) {
    return 1;
  }

  const rate = 1 + numericSpeed / 100;
  return Number.parseFloat(Math.min(Math.max(rate, 0.7), 1.3).toFixed(2));
}
