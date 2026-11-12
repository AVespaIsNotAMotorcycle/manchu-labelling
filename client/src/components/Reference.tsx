import { referenceForms } from "@manchu-labelling/script";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const STORAGE_KEY = "reference-width";
const TAB_STORAGE_KEY = "reference-tab";
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

const forms = (letters: string) => letters.split(" ").map(referenceForms);

/**
 * The letter groups. The syllable groups show where a letter changes shape with the vowel after it.
 */
const TABS = [
  { id: "vowels", name: "Vowels", letters: forms("a e i o v u ai ei ui oi vi") },
  {
    id: "consonants",
    name: "Consonants",
    letters: forms("n ng k g h b p s x t d l m q j y r f w"),
  },
  {
    id: "chinese",
    name: "Chinese transliteration",
    letters: forms("k' g' h' c cy' z zy' r' sy' qy' zh jy' y'"),
  },
  {
    id: "b-syllables",
    name: "B syllables",
    letters: forms("ba be bi bo bu"),
  },
  {
    id: "glottal-syllables",
    name: "Glottal syllables",
    letters: forms("ke ku ki ge gu gi he hu hi ka ga ha ko go ho kv gv hv"),
  },
];

function readSavedTab(): string {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    return TABS.some(({ id }) => id === saved) ? (saved as string) : "vowels";
  } catch {
    return "vowels";
  }
}

function LetterTabs() {
  const [selected, setSelected] = useState(readSavedTab);
  const tabList = useRef<HTMLDivElement>(null);
  const tab = TABS.find(({ id }) => id === selected) ?? (TABS[0] as (typeof TABS)[number]);

  function select(id: string) {
    setSelected(id);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, id);
    } catch {
      // The tab just lasts for this visit if the browser blocks storage.
    }
  }

  // Arrow keys move between tabs, as in other tab lists.
  function moveWithKeyboard(event: KeyboardEvent) {
    const index = TABS.findIndex(({ id }) => id === selected);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const target =
      event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : step && index + step;
    if (target === undefined || target < 0 || target >= TABS.length) return;
    event.preventDefault();
    select((TABS[target] as (typeof TABS)[number]).id);
    tabList.current?.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus();
  }

  return (
    <div>
      <div
        className="letter-tabs"
        role="tablist"
        aria-label="Letter groups"
        ref={tabList}
        onKeyDown={moveWithKeyboard}
      >
        {TABS.map(({ id, name }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`letter-tab-${id}`}
            aria-selected={id === selected}
            aria-controls="letter-tab-panel"
            tabIndex={id === selected ? 0 : -1}
            onClick={() => select(id)}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        className="letter-columns"
        role="tabpanel"
        id="letter-tab-panel"
        aria-labelledby={`letter-tab-${tab.id}`}
      >
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
            {tab.letters.map(({ abkai, initial, medial, final }) => (
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
  );
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
          <LetterTabs />
        </div>
      </aside>
    </>
  );
}
