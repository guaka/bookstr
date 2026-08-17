import { GitHubIcon } from './Icons'

const buildTime = import.meta.env.VITE_BUILD_TIME

function buildLabel() {
  if (!buildTime) return 'Development build'

  const date = new Date(buildTime)
  if (Number.isNaN(date.getTime())) return 'Build time unavailable'

  return `Built ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)} UTC`
}

export function Footer() {
  return (
    <footer className="site-footer">
      <a
        className="footer-github"
        href="https://github.com/guaka/bookstr"
        target="_blank"
        rel="noreferrer"
        aria-label="Bookstr on GitHub"
      >
        <GitHubIcon />
        <span>GitHub</span>
      </a>
      <span>{buildLabel()}</span>
    </footer>
  )
}
