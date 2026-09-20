output "status_page_url" {
  value = "https://${var.status_page_subdomain}.betteruptime.com"
}

output "relay_monitor_id" {
  value = betteruptime_monitor.relay_health.id
}

output "frontend_monitor_id" {
  value = betteruptime_monitor.frontend_health.id
}

output "sentry_error_rate_monitor_id" {
  value = betteruptime_monitor.sentry_error_rate.id
}

output "relay_deep_health_monitor_id" {
  value = betteruptime_monitor.relay_deep_health.id
}

output "marketing_monitor_id" {
  value = betteruptime_monitor.marketing.id
}

output "help_monitor_id" {
  value = betteruptime_monitor.help.id
}

output "downloads_monitor_id" {
  value = betteruptime_monitor.downloads.id
}
