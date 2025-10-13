# Retainless

Privacy-preserving app analytics with no client code.

## retainless-collector

Gathers and anonymizes server access logs to collect user retention and
usage patterns without exposing user privacy.

### How it works:

1. Server access logs are analyzed weekly to determine roughly-unique users based
   on `IP Address` and `User-Agent` data.
1. Retention data from weekly salted/hashed identifiers is used to match week-over-week
   returning users.
1. Metrics are written to CloudWatch for dashboarding.
