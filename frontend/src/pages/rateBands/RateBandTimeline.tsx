import type { RateBand, RateBandGap } from '../../api/types'
import { bandIntervals, parseTimeToMinutes } from '../../lib/timeOfDay'

const PALETTE = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2']

function colorForIndex(index: number): string {
  return PALETTE[index % PALETTE.length]
}

interface RateBandTimelineProps {
  bands: RateBand[]
  gaps: RateBandGap[]
}

export function RateBandTimeline({ bands, gaps }: RateBandTimelineProps) {
  return (
    <div>
      <div className="timeline" role="img" aria-label="Bản đồ phủ 24h các khung giờ">
        {bands.map((band, index) =>
          bandIntervals(band.startTime, band.endTime).map(([start, end], segmentIndex) => (
            <div
              key={`${band.id}-${segmentIndex}`}
              className="timeline-segment"
              style={{
                left: `${(start / 1440) * 100}%`,
                width: `${((end - start) / 1440) * 100}%`,
                background: colorForIndex(index),
              }}
              title={`${band.name}: ${band.startTime}-${band.endTime}`}
            >
              {band.name}
            </div>
          ))
        )}
        {gaps.map((gap, index) => {
          const start = parseTimeToMinutes(gap.startTime)
          const rawEnd = parseTimeToMinutes(gap.endTime)
          const end = rawEnd <= start ? 1440 : rawEnd
          return (
            <div
              key={`gap-${index}`}
              className="timeline-segment timeline-gap"
              data-testid="timeline-gap"
              style={{ left: `${(start / 1440) * 100}%`, width: `${((end - start) / 1440) * 100}%` }}
              title={`Khoảng trống chưa phủ: ${gap.startTime}-${gap.endTime}`}
            >
              Gap
            </div>
          )
        })}
      </div>
      <div className="timeline-labels">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
      <div className="legend">
        {bands.map((band, index) => (
          <span className="legend-item" key={band.id}>
            <span className="legend-swatch" style={{ background: colorForIndex(index) }} />
            {band.name} ({band.startTime}-{band.endTime})
          </span>
        ))}
        {gaps.length > 0 && (
          <span className="legend-item">
            <span className="legend-swatch timeline-gap" />
            Khoảng trống chưa phủ
          </span>
        )}
      </div>
    </div>
  )
}
