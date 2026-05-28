// hardcoded for now; rotate or move into env before any real performance
const MEMBER_PASSCODE = "545461";

export function checkPasscode(passcode: unknown): boolean {
  return typeof passcode === "string" && passcode === MEMBER_PASSCODE;
}
