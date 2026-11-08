import { REFERENCE_LETTERS } from "@manchu-labelling/script";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const STORAGE_KEY = "reference-width";
const KEYBOARD_STEP = 32;
/** These match the limits on `.reference` in styles.css. */
const MIN_WIDTH = 304;
const SPACE_FOR_WORK = 384;

const maxWidth = () => Math.max(MIN_WIDTH, window.innerWidth - SPACE_FOR_WORK);
const clampWidth = (width: number) => Math.round(Math.min(Math.max(width, MIN_WIDTH), maxWidth()));

function readSavedWidth(): number | null {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved > 0 ? saved : null;
  } catch {
    return null;
  }
}

function saveWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // The width just lasts for this visit if the browser blocks storage.
  }
}

export function Reference() {
  // Until the user resizes the panel, its width comes from the stylesheet and follows the window.
  const [width, setWidth] = useState(readSavedWidth);
  const [shownWidth, setShownWidth] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const grabOffset = useRef<number | null>(null);

  useEffect(() => {
    const element = panel.current as HTMLElement;
    const observer = new ResizeObserver(() => setShownWidth(element.offsetWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (width !== null) saveWidth(width);
  }, [width]);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    grabOffset.current = (panel.current as HTMLElement).getBoundingClientRect().left - event.clientX;
  }

  function drag(event: PointerEvent<HTMLDivElement>) {
    if (grabOffset.current === null) return;
    const { right } = (panel.current as HTMLElement).getBoundingClientRect();
    setWidth(clampWidth(right - event.clientX - grabOffset.current));
  }

  function endDrag() {
    grabOffset.current = null;
  }

  function resizeWithKeyboard(event: KeyboardEvent) {
    // The handle is on the panel's left edge, so moving it left makes the panel wider.
    const change = { ArrowLeft: KEYBOARD_STEP, ArrowRight: -KEYBOARD_STEP }[event.key];
    if (!change) return;
    event.preventDefault();
    setWidth(clampWidth(shownWidth + change));
  }

  return (
    <>
      <div
        className="reference-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize letter forms"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth()}
        aria-valuenow={shownWidth}
        tabIndex={0}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={resizeWithKeyboard}
      />
      <aside
        ref={panel}
        className="reference"
        aria-label="Letter reference"
        style={width === null ? undefined : ({ "--reference-width": `${width}px` } as CSSProperties)}
      >
        <h2>Letter forms</h2>
        <div className="reference-contents">
          <ul className="resources">
            <li>
              <a
                href="https://www.manchustudiesgroup.org/wp-content/uploads/2020/06/Manchu-script-Roth-Li.pdf"
                target="_blank"
                rel="noreferrer"
              >
                The Manchu script (Roth Li, PDF)
              </a>
            </li>
            <li>
              <a
                href="https://www.manchustudiesgroup.org/introduction-to-manchu-in-21-lessons/"
                target="_blank"
                rel="noreferrer"
              >
                Introduction to Manchu in 21 Lessons
              </a>
            </li>
          </ul>
          <div className="letter-columns">
            <table>
              <thead>
                <tr>
                  <th>Abkai</th>
                  <th>Initial</th>
                  <th>Medial</th>
                  <th>Final</th>
                </tr>
              </thead>
              <tbody>
                {REFERENCE_LETTERS.map(({ abkai, initial, medial, final }) => (
                  <tr key={abkai}>
                    <th scope="row">{abkai}</th>
                    {[initial, medial, final].map((form) => (
                      <td key={form}>
                        <span className="manchu letter" lang="mnc">
                          {form}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    </>
  );
}
