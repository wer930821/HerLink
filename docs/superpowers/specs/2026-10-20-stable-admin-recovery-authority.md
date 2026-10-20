# Identity authority

`resolve_active_anonymous_chat_identity()` and `anonymous_identity_device_state` are the authority for translating the current auth principal into the canonical anonymous identity. Admin recovery should repair that mapping rather than rewrite canonical chat ownership.