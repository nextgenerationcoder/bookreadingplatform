#!/usr/bin/env node
// Converts one or more plain-text course ingestion files into courses.
// See server/src/courseImporter.js for the file format (same as
// import-book.js's, plus a required LEVEL: line).
//
// Run with: node scripts/import-course.js content/<file>.txt [more files...]
// (or `npm run import-course -- content/a.txt content/b.txt` from server/)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseCourseText, saveImportedCourse } from '../src/courseImporter.js';

async function main() {
  const inputArgs = process.argv.slice(2);
  if (!inputArgs.length) {
    console.error('Usage: node scripts/import-course.js <path-to-ingestion-file.txt> [more files...]');
    process.exit(1);
  }

  for (const inputArg of inputArgs) {
    const inputPath = path.resolve(process.cwd(), inputArg);
    const text = await fs.readFile(inputPath, 'utf-8');
    const course = parseCourseText(text);
    await saveImportedCourse(course);
    const sentenceCount = course.pages.reduce((n, p) => n + p.sentences.length, 0);
    console.log(`Imported "${course.title}" (${course.id}, ${course.level}): ${course.pages.length} page(s), ${sentenceCount} sentences.`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
