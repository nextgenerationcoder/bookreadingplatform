#!/usr/bin/env node
// One-off demo run of Step 1's importer against the real uploaded Lesson 2
// files (Starten wir! B1), to actually demonstrate - not just unit-test -
// the pipeline end to end. No Vision API key is configured in this
// environment, so visionExtractor below is a stub returning exercise data
// I (Claude) transcribed directly from the real textbook page images the
// user uploaded - not invented, not AI-guessed, hand-verified against the
// real scan, which is why every exercise below is recorded with
// extractionSource: 'manual' and confidence 1 rather than claiming an AI
// vision call happened that didn't. The real, unmodified pipeline code
// (rendering, cropping, transcript parsing, audio matching, idempotent
// upserts) is exactly what production uses; only this one stage is stubbed,
// exactly as the spec asked for automated tests to do.
//
// Run with: node scripts/demo-import-lesson2.js

import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  createImportJob,
  getImportJob,
  runTextbookImport,
  parseTranscriptLines,
} from '../src/textbookImporter.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { db } from '../src/db.js';

const UPLOADS_DIR = '/root/.claude/uploads/f27b6ad6-39a7-5b15-b71b-99b047f2cd3f';
const TEXTBOOK_PDF = path.join(UPLOADS_DIR, '7bc61364-22-33_starten_wir.pdf');
const TRANSCRIPT_PDF = path.join(UPLOADS_DIR, '3d7c8afd-lesson_2_transcribe.pdf');
const AUDIO_FILES = [
  '12b61c9b-1_04_Starten_wir_B1_L2_SW_2.mp3',
  '510dab3d-1_05_Starten_wir_B1_L2_B_3_4_6.mp3',
  'aa1989c4-1_06_Starten_wir_B1_L2_C_4_5.mp3',
];

async function extractPdfTextLines(filePath) {
  const data = await fs.readFile(filePath);
  const doc = await getDocument({ data: new Uint8Array(data) }).promise;
  const lines = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY = null;
    let current = '';
    for (const item of content.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 1) {
        lines.push(current);
        current = '';
      }
      current += item.str;
      lastY = y;
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Hand-transcribed directly from the real page images (pdfPageIndex is
// 1-based into TEXTBOOK_PDF, printed page = 20 + pdfPageIndex).
const PAGE_EXERCISES = {
  1: [ // printed page 21 - lesson opener, printed before any lettered section box
    {
      exerciseNumber: '1', subNumber: '', sectionLetter: '', sectionTitle: '',
      exerciseType: 'speaking',
      instructions: 'Alle im Kurs. Sehen Sie das Foto an. Wo ist die Frau? Was macht sie? Raten Sie und benutzen Sie die Wörter.',
      content: { prompt: 'Ich vermute, dass sie ...', vocabHints: ['nach Feierabend zu Hause fernsehen', 'heimlich eine Serie gucken', 'nicht schlafen können', 'den Partner betrügen'] },
      images: [{ x0: 0.0, y0: 0.0, x1: 1.0, y1: 0.62, caption: 'Hero photo: woman on a sofa holding a pillow, looking worried' }],
      audioTrackRef: '', confidence: 1,
    },
    {
      exerciseNumber: '2', subNumber: '', sectionLetter: '', sectionTitle: '',
      exerciseType: 'listening',
      instructions: 'Hören Sie und vergleichen Sie mit Ihren Vermutungen in 1.',
      content: { prompt: 'Compare the audio to your guesses in exercise 1.' },
      images: [], audioTrackRef: '4', confidence: 1,
    },
    {
      exerciseNumber: '3', subNumber: '', sectionLetter: '', sectionTitle: '',
      exerciseType: 'speaking',
      instructions: 'Mit wem gucken Sie Serien am liebsten? Allein oder mit …? Warum?',
      content: { prompt: 'Open discussion question.' },
      images: [], audioTrackRef: '', confidence: 1,
    },
  ],
  2: [ // printed page 22 - reading passage + comprehension
    {
      exerciseNumber: '1', subNumber: '', sectionLetter: 'A', sectionTitle: 'Fremdschauen',
      exerciseType: 'reading',
      instructions: 'Zu zweit. Welches Thema hat der Text? Überfliegen Sie den Text und kreuzen Sie an.',
      content: {
        passage:
          'Serien – die Liebe und der Streit\n\nWer kennt das nicht? Man hat einen harten Arbeitstag hinter sich, endlich Feierabend und nun freut man sich auf die schönste Beschäftigung der Welt: Serien gucken mit der Partnerin oder dem Partner! Viele Menschen amüsieren sich heute am liebsten mit einer Folge ihrer Lieblingsserie bei einem der zahlreichen Streaming-Dienste. Laut einer amerikanischen Studie ist das für 72% der Paare zwischen 18 und 39 eine der wichtigsten Aktivitäten. Die Studie kommt auch zu dem Ergebnis, dass Serienschauen sogar gut für die Beziehung ist, obwohl die Erlebnisse nicht real sind. Serien verbessern die Partnerschaft, weil wir über die Charaktere wie über gemeinsame Freunde sprechen.\n\nAber Vorsicht! Serien können auch zu Problemen führen. In einer deutschen Studie kamen Serien auf Platz 3 der häufigsten Gründe für Konflikte. Man sitzt gemütlich auf der Couch und möchte eine Serie auswählen, doch dann geht es auf einmal los. Sie möchte lieber Comedy sehen, er lieber Science-Fiction. Er möchte eine Serie gucken, obwohl er sie schon dreimal gesehen hat. Und sie ist wütend. Und am Ende schauen beide doch ihr eigenes Programm, obwohl man den Abend eigentlich gemeinsam verbringen wollte.\n\nEin anderes Problem ist das "Fremdschauen". Man ist neugierig auf die nächste Folge, weil sie so spannend ist. Dann schaut man heimlich weiter, obwohl die Partnerin oder der Partner nicht da ist. Doch für all diese Probleme gibt es eine einfache Lösung: noch mehr Serien gucken! Denn vielleicht findet man ja so in einer der Serien auch Tipps für Kompromisse. Man muss es nur einmal schaffen, sich auf ein Programm zu einigen.',
        options: ['neue Serien aus den USA', 'Serien und das Leben von Paaren'],
      },
      images: [{ x0: 0.42, y0: 0.08, x1: 0.78, y1: 0.28, caption: 'Couple watching TV together with popcorn' }],
      audioTrackRef: '', confidence: 1,
    },
    {
      exerciseNumber: '2', subNumber: '', sectionLetter: 'A', sectionTitle: 'Fremdschauen',
      exerciseType: 'multiple_choice',
      instructions: 'Zu zweit. Lesen Sie 1 noch einmal. Was ist richtig? Kreuzen Sie an.',
      content: {
        questions: [
          { number: '1', text: 'Viele Leute gucken Serien', options: ['während der Arbeitszeit.', 'in ihrer Freizeit.'] },
          { number: '2', text: 'Viele Paare', options: ['gucken abends am liebsten Serien.', 'amüsieren sich abends mit verschiedenen Freizeitaktivitäten.'] },
          { number: '3', text: 'Serien haben den Vorteil, dass', options: ['man sie gemeinsam mit Freunden schauen kann.', 'man über sie reden kann.'] },
          { number: '4', text: 'Serien', options: ['können der Grund dafür sein, dass Paare sich streiten.', 'verbessern immer die Partnerschaft.'] },
          { number: '5', text: 'Viele können nicht warten und sehen', options: ['mit dem Partner weiter.', 'ohne den Partner weiter.'] },
        ],
      },
      images: [], audioTrackRef: '', confidence: 1,
    },
  ],
  4: [ // printed page 24 - photo matching + listening true/false
    {
      exerciseNumber: '2', subNumber: '', sectionLetter: 'B', sectionTitle: 'Streiten und gemeinsam planen',
      exerciseType: 'matching',
      instructions: 'Zu zweit. Welcher Satz passt zu welchem Foto? Ordnen Sie zu.',
      content: {
        left: ['Also, erst essen und dann einen Film, ja.', 'Ich finde, das wird langsam zum Problem.', 'Hurra, wir fahren nach Brasilien!!!'],
        right: ['Jana und Christoph', 'Melissa und David', 'Lisa und Florian'],
      },
      images: [
        { x0: 0.05, y0: 0.28, x1: 0.35, y1: 0.47, caption: 'Jana und Christoph' },
        { x0: 0.37, y0: 0.28, x1: 0.65, y1: 0.47, caption: 'Melissa und David' },
        { x0: 0.67, y0: 0.28, x1: 0.95, y1: 0.47, caption: 'Lisa und Florian' },
      ],
      audioTrackRef: '', confidence: 1,
    },
    {
      exerciseNumber: '4', subNumber: '', sectionLetter: 'B', sectionTitle: 'Streiten und gemeinsam planen',
      exerciseType: 'true_false',
      instructions: 'Hören Sie noch einmal. Ist das richtig (r) oder falsch (f)? Kreuzen Sie an.',
      content: {
        questions: [
          { number: '1', text: 'Lisa sagt, dass man zunimmt, wenn man während des Essens fernsieht.' },
          { number: '2', text: 'Lisa findet, dass nur Erwachsene Filme mit Superhelden sehen sollten.' },
          { number: '3', text: 'Melissa hat keine Lust auf ein Abendessen bei Davids Kollegin.' },
          { number: '4', text: 'David findet, dass Melissa viel zu viel Zeit vor dem Bildschirm verbringt.' },
          { number: '5', text: 'Christoph erinnert an Mallorca und Holland und behauptet, dass während dieser Reisen kaum etwas passiert ist.' },
          { number: '6', text: 'Jana freut sich, weil man während eines Flugs auch Filme sehen kann.' },
        ],
      },
      images: [], audioTrackRef: '5', confidence: 1,
    },
  ],
};

async function main() {
  const transcriptLines = await extractPdfTextLines(TRANSCRIPT_PDF);
  const transcriptSections = parseTranscriptLines(transcriptLines);
  console.log(`Parsed ${transcriptSections.length} transcript sections from the real transcript PDF:`);
  for (const s of transcriptSections) console.log(`  - ${s.exerciseLabel} (${s.segments.length} speaker turns)`);

  const audioFiles = [];
  for (const name of AUDIO_FILES) {
    audioFiles.push({ originalFilename: name.replace(/^[0-9a-f]{8}-/, ''), buffer: await fs.readFile(path.join(UPLOADS_DIR, name)) });
  }

  const bookId = 'starten-wir-b1';
  const jobId = createImportJob({ userId: 'demo-user', bookId, lessonNumber: 2, sourceFiles: {} });

  const result = await runTextbookImport(jobId, {
    userId: 'demo-user', bookId, bookTitle: 'Starten wir! B1', lessonNumber: 2, lessonTitle: 'Paare, Serien & mehr',
    pdfPath: TEXTBOOK_PDF, printedPageStart: 21, transcriptSections, audioFiles,
    visionExtractor: ({ pageIndex }) => ({
      pageHasNoExercises: !PAGE_EXERCISES[pageIndex],
      exercises: (PAGE_EXERCISES[pageIndex] || []).map((ex) => ({
        ...ex, contentJson: JSON.stringify(ex.content), extractionSource: 'manual',
      })),
    }),
  });

  console.log(`\nImport job ${jobId}: ${result.exercisesFound} exercise(s) persisted, ${result.errors.length} error(s).`);
  for (const e of result.errors) console.log('  ERROR:', e);

  console.log('\n--- Verification ---');
  const exerciseRows = db.prepare('SELECT * FROM tb_exercises WHERE book_id = ? ORDER BY order_index').all(bookId);
  for (const row of exerciseRows) {
    const images = db.prepare('SELECT * FROM tb_exercise_images WHERE exercise_id = ?').all(row.id);
    const audio = db.prepare('SELECT a.original_filename FROM tb_audio_files a JOIN tb_exercise_audio ea ON ea.audio_id = a.id WHERE ea.exercise_id = ?').all(row.id);
    const transcripts = db.prepare('SELECT t.exercise_label FROM tb_transcripts t JOIN tb_exercise_transcripts et ON et.transcript_id = t.id WHERE et.exercise_id = ?').all(row.id);
    console.log(
      `Ex ${row.exercise_number} (${row.exercise_type}, page ${row.printed_page}): images=${images.length} audio=${audio.map((a) => a.original_filename).join(',') || '-'} transcript=${transcripts.map((t) => t.exercise_label).join(',') || '-'}`
    );
  }

  console.log(`\nDone. DB at ${process.env.DB_PATH}`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
