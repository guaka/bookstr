import { GitHubIcon } from './Icons'

const buildTime = import.meta.env.VITE_BUILD_TIME

function buildLabel() {
  if (!buildTime) return 'Development build'

  const date = new Date(buildTime)
  if (Number.isNaN(date.getTime())) return 'Build time unavailable'

  const part = (value: number) => String(value).padStart(2, '0')
  const day = `${date.getUTCFullYear()}-${part(date.getUTCMonth() + 1)}-${part(date.getUTCDate())}`
  const time = `${part(date.getUTCHours())}:${part(date.getUTCMinutes())}`
  return `Built ${day} ${time} UTC`
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
      </a>
      <span>{buildLabel()}</span>
    </footer>
  )
}
