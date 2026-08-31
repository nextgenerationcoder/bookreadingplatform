import { api } from '../../api.js';
import { renderSpeakingTask } from '../../components/SpeakingTask.js';
import { renderExitCheck } from './exitCheck.js';
import { renderRetrievalChallenge } from './retrievalChallenge.js';

// Mirrors server/src/learningEngine/scaffold.js's visibility rule - kept
// tiny and duplicated deliberately, since there's no shared-code mechanism
// between this Vite client and the server in this repo. See that file for
// the authoritative definition and comments.
function visibleAidsForScaffold(scaffoldLevel) {
  switch (scaffoldLevel) {
    case 'S3':
      return { showModel: true, showFrame: true, showWordBank: true };
    case 'S2':
      return { showModel: false, showFrame: true, showWordBank: false };
    default:
      return { showModel: false, showFrame: false, showWordBank: false };
  }
}

export async function renderLessonPlayer(host, courseId, lessonId) {
  host.innerHTML = '<div class="loading">Loading…</div>';

  let courseData, lessonData;
  try {
    [courseData, lessonData] = await Promise.all([
      api.getLearningCourse(courseId),
      api.getLearningLesson(courseId, lessonId),
    ]);
  } catch (err) {
    host.innerHTML = `<div class="error">Couldn't load this lesson.<br><small>${err.message}</small></div>`;
    return;
  }

  const { lesson, progress } = lessonData;
  const lessonMeta = courseData.lessons.find((l) => l.id === lessonId);
  const phaseName = courseData.phases.find((p) => p.number === lesson.phase)?.name || `Phase ${lesson.phase}`;
  const lessonNumber = Number(lessonId.replace(/\D/g, ''));

  const completedStepIds = new Set(Object.keys(progress.stepResponses).filter((id) => progress.stepResponses[id]?.completed));

  let phase;
  let currentIndex = progress.currentStepIndex || 0;
  if (progress.retrievalChallenge) phase = 'summary';
  else if (progress.exitCheck) phase = 'retrieval';
  else if (currentIndex >= lesson.steps.length) phase = 'exitCheck';
  else phase = 'steps';

  renderShell();

  function renderShell() {
    host.innerHTML = `
      <div class="lessonPlayer">
        <div class="lessonTopBar">
          <a href="#/learning/${encodeURIComponent(courseId)}" class="backLink">← ${escapeHtml(courseData.title)}</a>
          <div class="lessonTopMeta">${escapeHtml(phaseName)} · Lesson ${lessonNumber} of ${courseData.lessonCount || courseData.lessons?.length || ''}</div>
          <div class="progressBar"><div class="progressFill" id="lessonProgressFill"></div></div>
        </div>
        <div id="lessonBody"></div>
      </div>
    `;
    updateProgressBar();
    renderPhase();
  }

  function updateProgressBar() {
    const fill = host.querySelector('#lessonProgressFill');
    if (!fill) return;
    let pct;
    if (phase === 'steps') pct = Math.round((currentIndex / lesson.steps.length) * 70);
    else if (phase === 'exitCheck') pct = 75;
    else if (phase === 'retrieval') pct = 90;
    else pct = 100;
    fill.style.width = `${pct}%`;
  }

  function renderPhase() {
    const body = host.querySelector('#lessonBody');
    if (phase === 'steps') renderStepPhase(body);
    else if (phase === 'exitCheck') {
      renderExitCheck(body, lesson, {
        onSubmit: async (responses) => {
          try {
            await api.submitExitCheck(courseId, lessonId, responses);
          } catch (err) {
            body.insertAdjacentHTML('beforeend', `<div class="importStatus error">Error: ${escapeHtml(err.message)}</div>`);
            return;
          }
          phase = 'retrieval';
          updateProgressBar();
          renderPhase();
        },
      });
    } else if (phase === 'retrieval') {
      renderRetrievalChallenge(body, lesson, {
        onSubmit: async (responses) => {
          try {
            await api.submitRetrievalChallenge(courseId, lessonId, responses);
          } catch (err) {
            body.insertAdjacentHTML('beforeend', `<div class="importStatus error">Error: ${escapeHtml(err.message)}</div>`);
            return;
          }
          phase = 'summary';
          updateProgressBar();
          renderPhase();
        },
      });
    } else {
      renderSummary(body);
    }
  }

  function renderStepPhase(body) {
    const step = lesson.steps[currentIndex];
    const alreadyCompleted = completedStepIds.has(step.id);
    const aids = visibleAidsForScaffold(step.scaffoldLevel);

    body.innerHTML = `
      <div class="microStep" data-step-id="${escapeHtml(step.id)}">
        ${step.teaches ? `<div class="newElementBox"><div class="newElementLabel">New</div><div class="newElementText">${escapeHtml(step.teaches)}</div></div>` : ''}
        ${step.question ? `<div class="hint" style="padding:6px 0">Interviewer asks: <strong>${escapeHtml(step.question)}</strong></div>` : ''}
        ${aids.showModel && step.model ? `<div class="modelBox">${escapeHtml(step.model)}</div>` : ''}
        ${step.seededModel ? `<div class="seededBox">${escapeHtml(step.seededModel.text)}<div class="hint" style="padding:4px 0 0">${escapeHtml(step.seededModel.note || '')}</div></div>` : ''}
        ${aids.showFrame && step.frame ? `<div class="frameBox">${escapeHtml(step.frame)}</div>` : ''}
        ${aids.showWordBank && step.wordBank ? `<div class="wordBankChips">${step.wordBank.map((w) => `<span class="chip">${escapeHtml(w)}</span>`).join('')}</div>` : ''}
        ${aids.showWordBank && step.actionBank ? `<div class="wordBankChips">${step.actionBank.map((w) => `<span class="chip">${escapeHtml(w)}</span>`).join('')}</div>` : ''}
        <p class="stepInstruction">${escapeHtml(step.instruction)}</p>
        <div class="productionList"></div>
        ${alreadyCompleted ? '<div class="hint" style="padding:6px 0 0">✓ You already completed this step.</div>' : ''}
      </div>
      <div class="formActions lessonNav">
        <button type="button" id="lessonBackBtn" ${currentIndex === 0 ? 'disabled' : ''}>← Back</button>
        <button type="button" id="lessonContinueBtn" ${alreadyCompleted ? '' : 'disabled'}>Continue</button>
      </div>
    `;

    const productionList = body.querySelector('.productionList');
    const continueBtn = body.querySelector('#lessonContinueBtn');
    const backBtn = body.querySelector('#lessonBackBtn');
    const doneFlags = new Array(step.productions.length).fill(alreadyCompleted);

    step.productions.forEach((production, i) => {
      const item = document.createElement('div');
      item.className = 'productionItem';
      productionList.appendChild(item);
      renderSpeakingTask(item, {
        prompt: production.prompt,
        note: production.note,
        onChange: (result) => {
          doneFlags[i] = result.done;
          continueBtn.disabled = !doneFlags.every(Boolean);
        },
      });
    });

    backBtn.onclick = () => {
      currentIndex -= 1;
      updateProgressBar();
      renderStepPhase(body);
    };

    continueBtn.onclick = async () => {
      continueBtn.disabled = true;
      const nextIndex = currentIndex + 1;
      try {
        await api.saveLearningStep(courseId, lessonId, {
          stepIndex: nextIndex,
          stepId: step.id,
          response: { completed: true },
        });
      } catch (err) {
        body.insertAdjacentHTML('beforeend', `<div class="importStatus error">Error: ${escapeHtml(err.message)}</div>`);
        continueBtn.disabled = false;
        return;
      }
      completedStepIds.add(step.id);
      currentIndex = nextIndex;
      if (currentIndex >= lesson.steps.length) {
        phase = 'exitCheck';
      }
      updateProgressBar();
      renderPhase();
    };
  }

  function renderSummary(body) {
    body.innerHTML = `
      <div class="lessonSummary">
        <h2>Lesson complete</h2>
        <p class="hint" style="padding:0">You've finished all 13 steps, the exit check, and the retrieval challenge.</p>
        <a class="button" href="#/learning/${encodeURIComponent(courseId)}">Back to course overview</a>
      </div>
    `;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
