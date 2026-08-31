// Lesson 1 content for the active-recall LessonPlayer (client/src/components/LessonPlayer.js).
//
// Each step:
//   software: [{ german, persian }]  - new vocabulary/phrases taught THIS step only.
//   promptFa: the Persian sentence the learner must translate, or null for a
//             teach-only step (no input, just a Continue button).
//   expectedAnswer: the correct German sentence for validation/hints, or
//             null alongside promptFa: null.
//
// Never render expectedAnswer in the DOM before the learner answers
// correctly - see LessonPlayer.js.

export const lesson1 = {
  id: 'lesson1',
  courseId: 'deutsch-almani-lektion-1',
  title: 'Lesson 1',
  backHref: '#/courses/A1',
  backLabel: '← Courses',
  storageKey: 'lesson-progress-1-v1',
  // This lesson only ever uses formal "Sie" - never "ihr" - across all 65
  // steps (confirmed: "Sie" appears in 32/56 answerable steps, "ihr" in
  // none). Passed as an always-on ASR hotword alongside each step's own
  // new words - see components/LessonPlayer.js.
  registerHotwords: ['Sie'],
  steps: [
    { id: 1, software: [{ german: 'es ist', persian: 'آن است' }, { german: 'gut', persian: 'خوب' }], promptFa: 'آن خوب است.', expectedAnswer: 'Es ist gut.' },
    { id: 2, software: [{ german: 'was', persian: 'چه چیزی' }, { german: 'trinken', persian: 'نوشیدن' }, { german: 'wollen Sie', persian: 'شما می‌خواهید' }], promptFa: 'چه چیزی می‌خواهید شما بنوشید؟', expectedAnswer: 'Was wollen Sie trinken?' },
    { id: 3, software: [{ german: 'essen', persian: 'خوردن' }], promptFa: 'چه چیزی می‌خواهید شما بخورید؟', expectedAnswer: 'Was wollen Sie essen?' },
    { id: 4, software: [{ german: 'tun', persian: 'انجام دادن' }], promptFa: 'چه چیزی می‌خواهید شما انجام دهید؟', expectedAnswer: 'Was wollen Sie tun?' },
    { id: 5, software: [{ german: 'kommen', persian: 'آمدن' }], promptFa: 'می‌خواهید شما بیایید؟', expectedAnswer: 'Wollen Sie kommen?' },
    { id: 6, software: [{ german: 'mit mir', persian: 'با من' }], promptFa: 'می‌خواهید شما با من بیایید؟', expectedAnswer: 'Wollen Sie mit mir kommen?' },
    { id: 7, software: [{ german: 'heute', persian: 'امروز' }], promptFa: 'می‌خواهید شما امروز با من بیایید؟', expectedAnswer: 'Wollen Sie heute mit mir kommen?' },
    { id: 8, software: [{ german: 'Abend', persian: 'عصر' }, { german: 'heute Abend', persian: 'امروز عصر' }], promptFa: 'می‌خواهید شما امروز عصر با من بیایید؟', expectedAnswer: 'Wollen Sie heute Abend mit mir kommen?' },
    { id: 9, software: [{ german: 'sein', persian: 'بودن' }, { german: 'wann', persian: 'چه زمانی' }, { german: 'hier', persian: 'اینجا' }], promptFa: 'چه زمانی می‌خواهید شما اینجا باشید؟', expectedAnswer: 'Wann wollen Sie hier sein?' },
    { id: 10, software: [{ german: 'können Sie', persian: 'شما می‌توانید' }], promptFa: 'می‌توانید شما با من بیایید؟', expectedAnswer: 'Können Sie mit mir kommen?' },
    { id: 11, software: [], promptFa: 'می‌خواهید شما با من بیایید؟', expectedAnswer: 'Wollen Sie mit mir kommen?' },
    { id: 12, software: [{ german: 'ja', persian: 'بله' }, { german: 'nein', persian: 'نه' }, { german: 'bitte', persian: 'لطفاً' }], promptFa: null, expectedAnswer: null },
    { id: 13, software: [], promptFa: 'چه زمانی می‌خواهید شما با من بیایید؟', expectedAnswer: 'Wann wollen Sie mit mir kommen?' },
    { id: 14, software: [{ german: 'sehen', persian: 'دیدن' }], promptFa: 'چه زمانی می‌خواهید شما آن را ببینید؟', expectedAnswer: 'Wann wollen Sie es sehen?' },
    { id: 15, software: [], promptFa: 'می‌توانید شما آن را ببینید؟', expectedAnswer: 'Können Sie es sehen?' },
    { id: 16, software: [{ german: 'ich kann', persian: 'من می‌توانم' }, { german: 'ich will', persian: 'من می‌خواهم' }], promptFa: null, expectedAnswer: null },
    { id: 17, software: [{ german: 'wenn', persian: 'اگر' }], promptFa: 'اگر شما بخواهید.', expectedAnswer: 'Wenn Sie wollen.' },
    { id: 18, software: [{ german: 'Sie kommen', persian: 'شما می‌آیید' }, { german: 'wir kommen', persian: 'ما می‌آییم' }], promptFa: null, expectedAnswer: null },
    { id: 19, software: [], promptFa: 'می‌آیید شما؟', expectedAnswer: 'Kommen Sie?' },
    { id: 20, software: [], promptFa: 'چه زمانی می‌آیید شما؟', expectedAnswer: 'Wann kommen Sie?' },
    { id: 21, software: [{ german: 'ich komme', persian: 'من می‌آیم' }, { german: 'bald', persian: 'به‌زودی' }], promptFa: 'من به‌زودی می‌آیم.', expectedAnswer: 'Ich komme bald.' },
    { id: 22, software: [], promptFa: 'می‌توانید شما با من بیایید؟', expectedAnswer: 'Können Sie mit mir kommen?' },
    { id: 23, software: [{ german: 'bleiben', persian: 'ماندن' }, { german: 'wir bleiben', persian: 'ما می‌مانیم' }], promptFa: 'ما اینجا می‌مانیم.', expectedAnswer: 'Wir bleiben hier.' },
    { id: 24, software: [], promptFa: 'ما امروز اینجا می‌مانیم.', expectedAnswer: 'Wir bleiben heute hier.' },
    { id: 25, software: [], promptFa: 'ما امروز عصر اینجا می‌مانیم.', expectedAnswer: 'Wir bleiben heute Abend hier.' },
    { id: 26, software: [{ german: 'Sie bleiben', persian: 'شما می‌مانید' }], promptFa: 'می‌مانید شما؟', expectedAnswer: 'Bleiben Sie?' },
    { id: 27, software: [{ german: 'gehen', persian: 'رفتن' }, { german: 'wir gehen', persian: 'ما می‌رویم' }, { german: 'Sie gehen', persian: 'شما می‌روید' }], promptFa: null, expectedAnswer: null },
    { id: 28, software: [{ german: 'nicht', persian: 'فعل را منفی می‌کند' }, { german: 'jetzt', persian: 'الان' }, { german: 'jetzt nicht', persian: 'الان نه' }], promptFa: null, expectedAnswer: null },
    { id: 29, software: [], promptFa: 'من می‌خواهم آن را ببینم.', expectedAnswer: 'Ich will es sehen.' },
    { id: 30, software: [{ german: 'aber', persian: 'اما' }], promptFa: 'من می‌خواهم آن را ببینم، اما الان نه.', expectedAnswer: 'Ich will es sehen, aber jetzt nicht.' },
    { id: 31, software: [], promptFa: 'می‌توانید شما آن را ببینید؟', expectedAnswer: 'Können Sie es sehen?' },
    { id: 32, software: [], promptFa: 'من می‌توانم آن را ببینم.', expectedAnswer: 'Ich kann es sehen.' },
    { id: 33, software: [], promptFa: 'من نمی‌توانم شما را ببینم.', expectedAnswer: 'Ich kann Sie nicht sehen.' },
    { id: 34, software: [{ german: 'verstehen', persian: 'فهمیدن' }, { german: 'wir verstehen', persian: 'ما می‌فهمیم' }], promptFa: null, expectedAnswer: null },
    { id: 35, software: [], promptFa: 'ما شما را می‌فهمیم.', expectedAnswer: 'Wir verstehen Sie.' },
    { id: 36, software: [{ german: 'sehr', persian: 'خیلی' }, { german: 'sehr gut', persian: 'خیلی خوب' }], promptFa: 'آن خیلی خوب است.', expectedAnswer: 'Es ist sehr gut.' },
    { id: 37, software: [], promptFa: 'ما نمی‌فهمیم.', expectedAnswer: 'Wir verstehen nicht.' },
    { id: 38, software: [], promptFa: 'ما آن را نمی‌فهمیم.', expectedAnswer: 'Wir verstehen es nicht.' },
    { id: 39, software: [], promptFa: 'ما شما را نمی‌فهمیم.', expectedAnswer: 'Wir verstehen Sie nicht.' },
    { id: 40, software: [], promptFa: 'ما شما را خیلی خوب نمی‌فهمیم.', expectedAnswer: 'Wir verstehen Sie nicht sehr gut.' },
    { id: 41, software: [], promptFa: 'می‌فهمید شما؟', expectedAnswer: 'Verstehen Sie?' },
    { id: 42, software: [], promptFa: 'شما آن را می‌فهمید؟', expectedAnswer: 'Verstehen Sie es?' },
    { id: 43, software: [{ german: 'mich', persian: 'من را' }], promptFa: 'شما من را می‌فهمید؟', expectedAnswer: 'Verstehen Sie mich?' },
    { id: 44, software: [], promptFa: 'شما من را نمی‌فهمید؟', expectedAnswer: 'Verstehen Sie mich nicht?' },
    { id: 45, software: [], promptFa: 'می‌توانید شما من را بفهمید؟', expectedAnswer: 'Können Sie mich verstehen?' },
    { id: 46, software: [{ german: 'ich kann nicht', persian: 'من نمی‌توانم' }], promptFa: 'من نمی‌توانم شما را بفهمم.', expectedAnswer: 'Ich kann Sie nicht verstehen.' },
    { id: 47, software: [{ german: 'es tut mir leid', persian: 'متأسفم' }], promptFa: 'متأسفم.', expectedAnswer: 'Es tut mir leid.' },
    { id: 48, software: [], promptFa: 'متأسفم، اما من نمی‌توانم شما را بفهمم.', expectedAnswer: 'Es tut mir leid, aber ich kann Sie nicht verstehen.' },
    { id: 49, software: [], promptFa: 'ما نمی‌مانیم.', expectedAnswer: 'Wir bleiben nicht.' },
    { id: 50, software: [], promptFa: 'ما اینجا نمی‌مانیم.', expectedAnswer: 'Wir bleiben hier nicht.' },
    { id: 51, software: [{ german: 'lange', persian: 'مدت زیاد / طولانی' }], promptFa: 'ما نمی‌توانیم اینجا مدت زیادی بمانیم.', expectedAnswer: 'Wir können hier nicht lange bleiben.' },
    { id: 52, software: [{ german: 'wie lange', persian: 'چه مدت' }], promptFa: 'چه مدت می‌توانید شما اینجا بمانید؟', expectedAnswer: 'Wie lange können Sie hier bleiben?' },
    { id: 53, software: [{ german: 'ich muss', persian: 'من باید' }], promptFa: 'من باید آن را ببینم.', expectedAnswer: 'Ich muss es sehen.' },
    { id: 54, software: [], promptFa: 'من باید اینجا بمانم.', expectedAnswer: 'Ich muss hier bleiben.' },
    { id: 55, software: [], promptFa: 'اما من نمی‌توانم اینجا مدت زیادی بمانم.', expectedAnswer: 'Aber ich kann nicht lange hier bleiben.' },
    { id: 56, software: [], promptFa: 'من باید به‌زودی بروم.', expectedAnswer: 'Ich muss bald gehen.' },
    { id: 57, software: [{ german: 'mir', persian: 'به من' }], promptFa: null, expectedAnswer: null },
    { id: 58, software: [], promptFa: 'شما من را می‌فهمید؟', expectedAnswer: 'Verstehen Sie mich?' },
    { id: 59, software: [{ german: 'bringen', persian: 'آوردن' }], promptFa: null, expectedAnswer: null },
    { id: 60, software: [{ german: 'finden', persian: 'پیدا کردن' }], promptFa: 'متأسفم، اما من نمی‌توانم آن را پیدا کنم.', expectedAnswer: 'Es tut mir leid, aber ich kann es nicht finden.' },
    { id: 61, software: [{ german: 'weiß', persian: 'سفید' }, { german: 'Weißwein', persian: 'شراب سفید' }], promptFa: null, expectedAnswer: null },
    { id: 62, software: [{ german: 'ich weiß', persian: 'من می‌دانم' }], promptFa: 'من آن را می‌دانم.', expectedAnswer: 'Ich weiß es.' },
    { id: 63, software: [], promptFa: 'من آن را نمی‌دانم.', expectedAnswer: 'Ich weiß es nicht.' },
    { id: 64, software: [{ german: 'wo', persian: 'کجا' }], promptFa: 'من نمی‌دانم آن کجاست.', expectedAnswer: 'Ich weiß nicht, wo es ist.' },
    { id: 65, software: [], promptFa: 'من نمی‌دانم آن کجاست، من نمی‌توانم آن را پیدا کنم.', expectedAnswer: 'Ich weiß nicht, wo es ist. Ich kann es nicht finden.' },
  ],
};
