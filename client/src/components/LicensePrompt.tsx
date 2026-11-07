export function LicensePrompt({ onAccept }: { onAccept: () => void }) {
  return (
    <section className="card">
      <h1>Before you start</h1>
      <p>
        Your labels will become part of a public dataset. By continuing, you agree to release them under
        the{" "}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
          Creative Commons Attribution 4.0
        </a>{" "}
        license.
      </p>
      <button type="button" onClick={onAccept}>
        I agree
      </button>
    </section>
  );
}
