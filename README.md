# HerLink

HerLink is an independently developed, open-source anonymous real-time chat platform focused on privacy-conscious conversations and lightweight identity.

The project is actively maintained and deployed for real-world use. Development is driven by production reliability, user feedback, safety, and the practical challenges of operating an anonymous realtime service.

## What HerLink includes

- Anonymous realtime chat and matchmaking flows
- Persistent anonymous identities and conversation recovery
- Realtime presence, queue, and session state
- Conversation history and session validation
- Safety and moderation tooling
- Administrative diagnostics and service monitoring
- Android notification support
- Web and Android clients
- CI/CD and Android build automation
- Production-oriented recovery and reliability workflows
- Optional interaction features such as milestones, achievements, and seasonal effects

## Technology

HerLink is built primarily with:

- React Native
- Expo
- TypeScript
- Expo Router
- Supabase
- PostgreSQL / Row Level Security
- Supabase Realtime
- GitHub Actions

The project targets web and Android while sharing as much application logic as practical.

## Project goals

HerLink aims to make anonymous conversation simple while preserving continuity and safety.

Operating an anonymous realtime platform creates engineering challenges around identity recovery, stale sessions, reconnect behavior, duplicate subscriptions, realtime reliability, moderation, privacy, and safe administration. The project treats those as core product problems rather than demo-only concerns.

## Active development

HerLink is maintained continuously based on real production behavior and user reports. Recent work includes:

- Realtime connection and reconnection reliability
- Anonymous identity and chat recovery
- Android push notification delivery
- Session and queue correctness
- Admin diagnostics
- CI/CD and APK build reliability
- Mobile and desktop UI improvements

## Development

Install dependencies:

```bash
npm install
```

Start the Expo development server:

```bash
npm start
```

Other available commands:

```bash
npm run android
npm run ios
npm run web
```

Some production features require project-specific Supabase configuration and environment variables. Secrets and production credentials are intentionally not included in this repository.

## Security and privacy

Please do not commit API secrets, service-role keys, private user data, production credentials, or recovery information.

If you discover a security or privacy issue, avoid publishing sensitive exploit details or user information in a public issue.

## Contributing

Issues and pull requests that improve reliability, accessibility, privacy, security, documentation, or maintainability are welcome.

Before contributing, please avoid including real conversation content, personal data, credentials, or production-only identifiers in commits, screenshots, issues, or pull requests.

## Maintainer

HerLink is independently developed and maintained by [@wer930821](https://github.com/wer930821).

## License

See [LICENSE](LICENSE) for the repository's current license information.
