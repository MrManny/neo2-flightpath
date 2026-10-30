// The summary carries ffprobe's rational rate ("60000/1001"); people read it as
// decimal fps, rounded to hundredths so NTSC rates read 59.94 and 29.97.
export function formatFrameRate(rate: string): string {
  const ratio = /^(\d+)\/(\d+)$/.exec(rate);
  const num = ratio ? Number(ratio[1]) : Number(rate);
  const den = ratio ? Number(ratio[2]) : 1;
  if (!(num > 0) || !(den > 0)) return rate;
  return `${Math.round((num / den) * 100) / 100} fps`;
}
