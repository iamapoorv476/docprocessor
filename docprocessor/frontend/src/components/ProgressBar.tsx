interface ProgressBarProps {
    progress: number
    status?: string
}

export default function ProgressBar({progress, status}: ProgressBarProps){
    const cls = status === 'completed' ? 'done': status === 'failed' ? 'failed' : ''
    return(
        <div className="progress-wrap">
            <div
              className={`progress-bar ${cls}`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
        </div>
    )
}