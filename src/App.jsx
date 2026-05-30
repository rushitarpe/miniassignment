import { useState, useCallback, useRef } from 'react';
import './index.css';

/* ────────────────────────────────────────────
   PROMPT DATA
   ──────────────────────────────────────────── */
const TASKS = [
  {
    id: 1,
    color: 'green',
    badge: 'AI Workflow Redesign',
    title: 'Redesign a repetitive educational workflow using AI',
    prompt: `You are an AI operations and systems expert with experience in educational technology. I need to redesign the student progress report generation workflow at a school using AI. Current workflow: Teachers manually collect marks from multiple subjects each term. Each teacher writes individual comments for every student (30–40 students per class). Reports are compiled in Word documents and emailed to parents. The process takes 2–3 days per teacher and is error-prone. Please provide: 1. Problems with this current system. 2. A redesigned AI-powered workflow using Google Gemini, Google Sheets, and Make.com. 3. Step-by-step breakdown of the new automated process. 4. Expected benefits (time saved, accuracy, teacher wellbeing). 5. A Before vs After comparison table. Format as a professional workflow improvement report.`,
  },
  {
    id: 2,
    color: 'purple',
    badge: 'AI System Build',
    title: 'Build a practical educational system using AI tools',
    prompt: `You are an educational technology specialist. Help me build a practical AI-powered Student Quiz & Feedback System. The system should: allow a teacher to input a topic, automatically generate 5 quiz questions at easy/medium/hard difficulty, provide model answers and marking criteria, and generate personalised feedback for score ranges (0–40%: encouragement + revision tips, 41–70%: good effort + areas to improve, 71–100%: excellent + extension challenge). Please provide: 1. Full system design with tool flow. 2. Sample quiz on "The Water Cycle" for ages 12–14. 3. Sample personalised feedback for each score range. 4. Step-by-step teacher usage guide. 5. Limitations and improvements.`,
  },
  {
    id: 3,
    color: 'amber',
    badge: 'Maths Worksheet',
    title: 'Create a maths worksheet with scaffolded learning',
    prompt: `You are an experienced maths teacher creating resources for students aged 10–15. Create a scaffolded Maths worksheet on "Introduction to Algebra — Solving One-Step Equations". Include: Section 1 — Concept explanation using a real-world analogy (balance scale). Section 2 — 3 worked examples with increasing difficulty (addition, subtraction, multiplication). Section 3 — 4 guided practice questions with hints. Section 4 — 6 independent practice questions (easy to hard). Section 5 — 1 challenge word problem. Section 6 — Reflection box ("What did you find easy? What do you want to practice?"). Format as a print-ready worksheet with name/date/class field and encouraging note at the bottom.`,
  },
];

/* ────────────────────────────────────────────
   APP COMPONENT
   ──────────────────────────────────────────── */
export default function App() {
  const [openCards, setOpenCards] = useState([true, false, false]);
  const [prompts, setPrompts] = useState(TASKS.map((t) => t.prompt));
  const [outputs, setOutputs] = useState(['', '', '']);
  const [loading, setLoading] = useState([false, false, false]);
  const [errors, setErrors] = useState(['', '', '']);
  const [outputVisible, setOutputVisible] = useState([false, false, false]);
  const [streamDone, setStreamDone] = useState([false, false, false]);
  const [copyState, setCopyState] = useState({ prompt: [false, false, false], output: [false, false, false] });
  
  const envApiKey = import.meta.env.VITE_GEMINI_API_KEY || '';

  /* refs to allow cancellation / cleanup */
  const abortRefs = useRef([null, null, null]);

  /* ── helpers ── */
  const updateAt = (arr, idx, val) => arr.map((v, i) => (i === idx ? val : v));

  const toggleCard = useCallback((idx) => {
    setOpenCards((prev) => updateAt(prev, idx, !prev[idx]));
  }, []);

  const updatePrompt = useCallback((idx, value) => {
    setPrompts((prev) => updateAt(prev, idx, value));
  }, []);

  /* ── copy to clipboard ── */
  const copyText = useCallback(async (text, type, idx) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState((prev) => ({
        ...prev,
        [type]: updateAt(prev[type], idx, true),
      }));
      setTimeout(() => {
        setCopyState((prev) => ({
          ...prev,
          [type]: updateAt(prev[type], idx, false),
        }));
      }, 2000);
    } catch {
      /* clipboard may fail in some contexts – silently ignore */
    }
  }, []);

  /* ── API call with SSE streaming ── */
  const runWithAI = useCallback(async (idx) => {
    /* validate API key */
    if (!envApiKey.trim()) {
      setErrors((p) => updateAt(p, idx, 'Gemini API key is not configured. Please define VITE_GEMINI_API_KEY in your .env file.'));
      return;
    }

    /* abort any in-flight request for this task */
    if (abortRefs.current[idx]) abortRefs.current[idx].abort();
    const controller = new AbortController();
    abortRefs.current[idx] = controller;

    setLoading((p) => updateAt(p, idx, true));
    setErrors((p) => updateAt(p, idx, ''));
    setOutputs((p) => updateAt(p, idx, ''));
    setOutputVisible((p) => updateAt(p, idx, true));
    setStreamDone((p) => updateAt(p, idx, false));

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${envApiKey.trim()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompts[idx] }] }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`API ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); /* keep incomplete line in buffer */

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
              setOutputs((prev) => updateAt(prev, idx, prev[idx] + parsed.candidates[0].content.parts[0].text));
            }
          } catch {
            /* skip unparsable lines */
          }
        }
      }

      setStreamDone((p) => updateAt(p, idx, true));
    } catch (err) {
      if (err.name !== 'AbortError') {
        setErrors((p) => updateAt(p, idx, err.message || 'Something went wrong.'));
      }
    } finally {
      setLoading((p) => updateAt(p, idx, false));
      abortRefs.current[idx] = null;
    }
  }, [prompts, envApiKey]);

  /* ────────────────────────────────────────────
     RENDER
     ──────────────────────────────────────────── */
  return (
    <>
      {/* ── HEADER ── */}
      <header className="header" id="header">
        <div className="header-inner">
          <div className="header-logo">
            <span>A38</span>
          </div>
          <div className="header-text">
            <span className="header-org">AKademy38 Education</span>
            <span className="header-title">AI Operations &amp; Systems Assignment</span>
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}
      <main className="main" id="main-content">
        {/* Intro Banner */}
        <section className="intro-banner" id="intro-banner">
          <div className="intro-icon" aria-hidden="true">💡</div>
          <div className="intro-content">
            <h2>Getting Started</h2>
            <p>
              Each task below contains a pre-written AI prompt. You can edit the prompt to suit your
              needs, then click <strong>"Run with AI"</strong> to generate a response using Google Gemini,
              or <strong>"Copy Prompt"</strong> to paste it into your preferred AI tool.
            </p>
          </div>
        </section>

        {/* Task Cards */}
        <div className="task-cards" id="task-cards">
          {TASKS.map((task, idx) => (
            <article className="task-card" key={task.id} id={`task-card-${task.id}`}>
              {/* Card Header */}
              <div
                className="task-card-header"
                id={`task-header-${task.id}`}
                onClick={() => toggleCard(idx)}
                role="button"
                tabIndex={0}
                aria-expanded={openCards[idx]}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(idx); } }}
              >
                <div className={`task-number ${task.color}`}>{task.id}</div>
                <div className="task-header-content">
                  <span className={`task-badge ${task.color}`}>{task.badge}</span>
                  <h3 className="task-title">{task.title}</h3>
                </div>
                <div className={`task-chevron ${openCards[idx] ? 'open' : ''}`} aria-hidden="true">
                  ▾
                </div>
              </div>

              {/* Card Body */}
              <div className={`task-card-body-wrapper ${openCards[idx] ? 'open' : ''}`}>
                <div className="task-card-body">
                  {/* Prompt */}
                  <div className="prompt-label">Prompt</div>
                  <textarea
                    id={`prompt-textarea-${task.id}`}
                    className="prompt-textarea"
                    value={prompts[idx]}
                    onChange={(e) => updatePrompt(idx, e.target.value)}
                    spellCheck={false}
                  />

                  {/* Buttons */}
                  <div className="button-row">
                    <button
                      id={`btn-run-${task.id}`}
                      className="btn btn-primary"
                      onClick={() => runWithAI(idx)}
                      disabled={loading[idx]}
                    >
                      {loading[idx] ? (
                        <>
                          <span className="btn-spinner" /> Running…
                        </>
                      ) : (
                        '▶ Run with AI'
                      )}
                    </button>
                    <button
                      id={`btn-copy-prompt-${task.id}`}
                      className="btn btn-outline"
                      onClick={() => copyText(prompts[idx], 'prompt', idx)}
                    >
                      {copyState.prompt[idx] ? '✓ Copied!' : '⎘ Copy Prompt'}
                    </button>
                  </div>

                  {/* Error */}
                  {errors[idx] && (
                    <div className="error-banner" id={`error-${task.id}`}>
                      <span className="error-banner-icon">⚠</span>
                      <span>{errors[idx]}</span>
                    </div>
                  )}

                  {/* Output */}
                  {outputVisible[idx] && (
                    <div className="output-section" id={`output-${task.id}`}>
                      <div className="output-header">
                        <div className="output-status">
                          <span className={`output-dot ${streamDone[idx] ? 'done' : ''}`} />
                          <span className={`output-label ${streamDone[idx] ? 'done' : ''}`}>
                            {streamDone[idx] ? 'Done ✓' : 'Gemini is writing…'}
                          </span>
                        </div>
                        {outputs[idx] && (
                          <button
                            id={`btn-copy-output-${task.id}`}
                            className="btn-copy-output"
                            onClick={() => copyText(outputs[idx], 'output', idx)}
                          >
                            {copyState.output[idx] ? '✓ Copied!' : 'Copy Output'}
                          </button>
                        )}
                      </div>
                      <div className="output-body">{outputs[idx] || ' '}</div>
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>

      {/* ── FOOTER ── */}
      <footer className="footer" id="footer">
        <p>Built for AKademy38 Education · AI Operations &amp; Systems Assignment · Powered by Google Gemini</p>
      </footer>
    </>
  );
}
