variable "relay_health_url" {
  description = "Relay's shallow liveness endpoint (SA-29) — same one Fly's own healthcheck polls."
  type        = string
  default     = "https://scorehub-relay.fly.dev/health"
}

variable "frontend_health_url" {
  description = "Frontend's liveness endpoint (SA-48, frontend/app/api/health)."
  type        = string
  default     = "https://app.scorehub.co.nz/api/health"
}

variable "sentry_error_rate_url" {
  description = "Synthetic health signal for recent Sentry error volume (SA-48 free-tier path, see README)."
  type        = string
  default     = "https://app.scorehub.co.nz/api/health/sentry-error-rate"
}

variable "status_page_subdomain" {
  description = "Subdomain under betteruptime.com for Phase 1 (custom domain deferred to SA-111)."
  type        = string
  default     = "scorehub"
}

variable "check_frequency_seconds" {
  description = "How often Better Stack polls each monitor."
  type        = number
  default     = 30
}

# SA-109 — internal-only deep health check

variable "deep_health_secret" {
  description = <<-EOT
    Shared secret sent as the x-deep-health-secret header when polling
    relay's GET /health/deep (SA-109) — must match the relay deployment's
    DEEP_HEALTH_SECRET env var. No default; set via TF_VAR_deep_health_secret
    or a .tfvars file that's gitignored, same as BETTERUPTIME_API_TOKEN.
  EOT
  type        = string
  sensitive   = true
}

# SA-111 — marketing/help/downloads Workers + uat status page

variable "marketing_url" {
  description = "Marketing site (marketing/wrangler.jsonc's production custom_domain)."
  type        = string
  default     = "https://scorehub.co.nz"
}

variable "help_url" {
  description = "Help centre (help/wrangler.jsonc's production custom_domain)."
  type        = string
  default     = "https://help.scorehub.co.nz"
}

variable "downloads_url" {
  description = "Downloads redirect Worker (downloads/wrangler.jsonc's production custom_domain)."
  type        = string
  default     = "https://downloads.scorehub.co.nz"
}

# A private uat status page was scoped out for now (2026-08-24): the
# frontend uat hostname (app.uat.scorehub.co.nz) sits behind a two-layer
# block (Cloudflare Access + Vercel deployment protection, see
# docs/uat-environment.md), so a plain monitor would just show perpetually
# down without the same bypass dance documented there for the Stripe
# webhook fix. Revisit if uat monitoring becomes worth that setup cost.
