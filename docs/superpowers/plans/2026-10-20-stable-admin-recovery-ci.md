# CI expectation

CI must reject a recovery implementation that updates canonical source sessions, messages, contacts, or display name to the current auth profile. It must require stable device-state binding to the original anonymous identity.