// TÜV NORD Food GPT interview-prep lesson, in the same step-by-step
// active-recall format as lesson1.js (client/src/components/LessonPlayer.js
// renders both generically). Transcribed from the staged teacher/student
// dialogue for this interview answer - each step introduces one small new
// element (a word or short phrase) and immediately asks the learner to
// produce a full sentence with it, building up to five complete answer
// sentences by the end. Persian prompts (promptFa) were written for this
// transcription (the source dialogue gave English "Say:" cues); the German
// vocabulary/answers are taken directly from the source.
//
// Replaces the old stateful "Learning" section (learningEngine/*,
// views/learning/*, content/tuvNordInterview/*) with this simpler,
// already-proven lesson format instead.

export const tuvNordFoodGpt = {
  id: 'tuvNordFoodGpt',
  courseId: 'tuv-nord-food-gpt-lektion-1',
  title: 'TÜV NORD Food GPT - Interview',
  backHref: '#/courses',
  backLabel: '← Courses',
  storageKey: 'lesson-progress-tuv-nord-food-gpt-1-v1',
  steps: [
    // Stage 1 - basic person + verb
    { id: 1, software: [{ german: 'arbeiten', persian: 'کار کردن' }], promptFa: 'من کار می‌کنم.', expectedAnswer: 'Ich arbeite.' },
    { id: 2, software: [{ german: 'lernen', persian: 'یاد گرفتن / درس خواندن' }], promptFa: 'من درس می‌خوانم.', expectedAnswer: 'Ich lerne.' },
    { id: 3, software: [{ german: 'meine Familie', persian: 'خانواده‌ی من' }], promptFa: 'خانواده‌ی من کار می‌کند.', expectedAnswer: 'Meine Familie arbeitet.' },

    // Stage 2 - haben + Berufserfahrung
    { id: 4, software: [{ german: 'haben', persian: 'داشتن' }, { german: 'Erfahrung', persian: 'تجربه' }], promptFa: 'من تجربه دارم.', expectedAnswer: 'Ich habe Erfahrung.' },
    { id: 5, software: [{ german: 'Berufserfahrung', persian: 'سابقه‌ی کاری / تجربه‌ی حرفه‌ای' }], promptFa: 'من سابقه‌ی کاری دارم.', expectedAnswer: 'Ich habe Berufserfahrung.' },
    { id: 6, software: [{ german: 'vier Jahre', persian: 'چهار سال' }], promptFa: 'من چهار سال سابقه‌ی کاری دارم.', expectedAnswer: 'Ich habe vier Jahre Berufserfahrung.' },
    { id: 7, software: [{ german: 'ungefähr', persian: 'حدود / تقریباً' }], promptFa: 'من تقریباً چهار سال سابقه‌ی کاری دارم.', expectedAnswer: 'Ich habe ungefähr vier Jahre Berufserfahrung.' },

    // Stage 3 - the industry
    {
      id: 8,
      software: [
        { german: 'Lebensmittel', persian: 'مواد غذایی' },
        { german: 'Industrie', persian: 'صنعت' },
        { german: 'in der Lebensmittelindustrie', persian: 'در صنعت مواد غذایی' },
      ],
      promptFa: 'من در صنعت مواد غذایی سابقه‌ی کاری دارم.',
      expectedAnswer: 'Ich habe Berufserfahrung in der Lebensmittelindustrie.',
    },
    { id: 9, software: [], promptFa: 'من چهار سال سابقه‌ی کاری در صنعت مواد غذایی دارم.', expectedAnswer: 'Ich habe vier Jahre Berufserfahrung in der Lebensmittelindustrie.' },
    { id: 10, software: [], promptFa: 'من تقریباً چهار سال سابقه‌ی کاری در صنعت مواد غذایی دارم.', expectedAnswer: 'Ich habe ungefähr vier Jahre Berufserfahrung in der Lebensmittelindustrie.' },

    // Stage 4 - Bereich / vor allem
    {
      id: 11,
      software: [
        { german: 'Bereich', persian: 'حوزه / زمینه' },
        { german: 'im Bereich', persian: 'در حوزه‌ی' },
        { german: 'Einkauf', persian: 'خرید' },
      ],
      promptFa: 'من در حوزه‌ی خرید تجربه دارم.',
      expectedAnswer: 'Ich habe Erfahrung im Bereich Einkauf.',
    },
    { id: 12, software: [{ german: 'vor allem', persian: 'مخصوصاً / به‌خصوص / عمدتاً' }], promptFa: 'من مخصوصاً در حوزه‌ی خرید تجربه دارم.', expectedAnswer: 'Ich habe Erfahrung vor allem im Bereich Einkauf.' },
    {
      id: 13,
      software: [],
      promptFa: 'من تقریباً چهار سال سابقه‌ی کاری در صنعت مواد غذایی دارم، مخصوصاً در حوزه‌ی خرید.',
      expectedAnswer: 'Ich habe ungefähr vier Jahre Berufserfahrung in der Lebensmittelindustrie, vor allem im Bereich Einkauf.',
    },

    // Stage 5 - plural Bereiche, first target sentence complete
    {
      id: 14,
      software: [
        { german: 'Bereiche', persian: 'حوزه‌ها (جمع)' },
        { german: 'in den Bereichen', persian: 'در حوزه‌های' },
        { german: 'Operations', persian: 'عملیات' },
      ],
      promptFa: 'مخصوصاً در حوزه‌های خرید و عملیات.',
      expectedAnswer: 'Vor allem in den Bereichen Einkauf und Operations',
    },
    { id: 15, software: [{ german: 'Projektmanagement', persian: 'مدیریت پروژه' }], promptFa: 'مخصوصاً در حوزه‌های خرید، عملیات و مدیریت پروژه.', expectedAnswer: 'Vor allem in den Bereichen Einkauf, Operations und Projektmanagement' },
    {
      id: 16,
      software: [],
      promptFa: 'من تقریباً چهار سال سابقه‌ی کاری در صنعت مواد غذایی دارم، مخصوصاً در حوزه‌های خرید، عملیات و مدیریت پروژه.',
      expectedAnswer: 'Ich habe ungefähr vier Jahre Berufserfahrung in der Lebensmittelindustrie, vor allem in den Bereichen Einkauf, Operations und Projektmanagement.',
    },

    // Stage 6 - aufwachsen
    { id: 17, software: [{ german: 'aufwachsen', persian: 'بزرگ شدن' }], promptFa: 'من بزرگ شدم.', expectedAnswer: 'Ich bin aufgewachsen.' },
    {
      id: 18,
      software: [{ german: 'mit', persian: 'با' }, { german: 'die Lebensmittelbranche', persian: 'صنعت مواد غذایی' }],
      promptFa: 'من با صنعت مواد غذایی بزرگ شدم.',
      expectedAnswer: 'Ich bin mit der Lebensmittelbranche aufgewachsen.',
    },
    { id: 19, software: [{ german: 'außerdem', persian: 'علاوه بر این' }], promptFa: 'علاوه بر این، من با صنعت مواد غذایی بزرگ شدم.', expectedAnswer: 'Außerdem bin ich mit der Lebensmittelbranche aufgewachsen.' },

    // Stage 7 - tätig sein / da, second target sentence complete
    {
      id: 20,
      software: [
        { german: 'tätig sein', persian: 'فعالیت داشتن / مشغول بودن' },
        { german: 'dieser Bereich', persian: 'این حوزه' },
        { german: 'in diesem Bereich', persian: 'در این حوزه' },
      ],
      promptFa: 'خانواده‌ی من در این حوزه فعالیت دارد.',
      expectedAnswer: 'Meine Familie ist in diesem Bereich tätig.',
    },
    { id: 21, software: [{ german: 'seit vielen Jahren', persian: 'سال‌های زیادی است که' }], promptFa: 'خانواده‌ی من سال‌های زیادی است که در این حوزه فعالیت دارد.', expectedAnswer: 'Meine Familie ist seit vielen Jahren in diesem Bereich tätig.' },
    {
      id: 22,
      software: [{ german: 'da', persian: 'چون / از آنجایی که' }],
      promptFa: 'علاوه بر این، من با صنعت مواد غذایی بزرگ شدم، چون خانواده‌ی من سال‌های زیادی است که در این حوزه فعالیت دارد.',
      expectedAnswer: 'Außerdem bin ich mit der Lebensmittelbranche aufgewachsen, da meine Familie seit vielen Jahren in diesem Bereich tätig ist.',
    },

    // Stage 8 - sich mit etwas beschäftigen
    {
      id: 23,
      software: [{ german: 'sich mit etwas beschäftigen', persian: 'به چیزی پرداختن' }, { german: 'KI', persian: 'هوش مصنوعی (Künstliche Intelligenz)' }],
      promptFa: 'من به هوش مصنوعی می‌پردازم.',
      expectedAnswer: 'Ich beschäftige mich mit KI.',
    },
    { id: 24, software: [], promptFa: 'من روی هوش مصنوعی کار کردم.', expectedAnswer: 'Ich habe mich mit KI beschäftigt.' },

    // Stage 9 - digitale Produkte, third target sentence complete
    { id: 25, software: [{ german: 'digital', persian: 'دیجیتال' }, { german: 'Produkte', persian: 'محصولات' }], promptFa: 'من روی محصولات دیجیتال کار کردم.', expectedAnswer: 'Ich habe mich mit digitalen Produkten beschäftigt.' },
    { id: 26, software: [{ german: 'KI-Anwendungen', persian: 'کاربردهای هوش مصنوعی' }], promptFa: 'من روی محصولات دیجیتال و کاربردهای هوش مصنوعی کار کردم.', expectedAnswer: 'Ich habe mich mit digitalen Produkten und KI-Anwendungen beschäftigt.' },
    {
      id: 27,
      software: [{ german: 'an der Universität', persian: 'در دانشگاه' }],
      promptFa: 'من در دانشگاه روی محصولات دیجیتال و کاربردهای هوش مصنوعی کار کردم.',
      expectedAnswer: 'Ich habe mich an der Universität mit digitalen Produkten und KI-Anwendungen beschäftigt.',
    },
    {
      id: 28,
      software: [{ german: 'stärker', persian: 'بیشتر / به شکل جدی‌تر' }],
      promptFa: 'من در دانشگاه به‌طور جدی‌تری روی محصولات دیجیتال و کاربردهای هوش مصنوعی کار کردم.',
      expectedAnswer: 'Ich habe mich an der Universität stärker mit digitalen Produkten und KI-Anwendungen beschäftigt.',
    },
    {
      id: 29,
      software: [{ german: 'in den letzten zwei Jahren', persian: 'در دو سال گذشته' }],
      promptFa: 'در دو سال گذشته، من در دانشگاه به‌طور جدی‌تری روی محصولات دیجیتال و کاربردهای هوش مصنوعی کار کردم.',
      expectedAnswer: 'In den letzten zwei Jahren habe ich mich an der Universität stärker mit digitalen Produkten und KI-Anwendungen beschäftigt.',
    },

    // Stage 10 - an etwas arbeiten
    {
      id: 30,
      software: [{ german: 'an etwas arbeiten', persian: 'روی چیزی کار کردن' }, { german: 'Softwareprojekt', persian: 'پروژه‌ی نرم‌افزاری' }],
      promptFa: 'من روی یک پروژه‌ی نرم‌افزاری کار می‌کنم.',
      expectedAnswer: 'Ich arbeite an einem Softwareprojekt.',
    },
    { id: 31, software: [{ german: 'Softwareprojekte', persian: 'پروژه‌های نرم‌افزاری (جمع)' }], promptFa: 'من روی پروژه‌های نرم‌افزاری کار کردم.', expectedAnswer: 'Ich habe an Softwareprojekten gearbeitet.' },
    {
      id: 32,
      software: [{ german: 'KI-Use-Case', persian: 'مورد کاربرد هوش مصنوعی' }, { german: 'verschiedene', persian: 'مختلف' }],
      promptFa: 'من روی پروژه‌های نرم‌افزاری و موارد کاربرد مختلف هوش مصنوعی کار کردم.',
      expectedAnswer: 'Ich habe an Softwareprojekten und verschiedenen KI-Use-Cases gearbeitet.',
    },

    // Stage 11 - Dabei
    {
      id: 33,
      software: [{ german: 'dabei', persian: 'در این فرایند / در حین این کار' }],
      promptFa: 'در این فرایند، من روی پروژه‌های نرم‌افزاری و موارد کاربرد مختلف هوش مصنوعی کار کردم.',
      expectedAnswer: 'Dabei habe ich an Softwareprojekten und verschiedenen KI-Use-Cases gearbeitet.',
    },

    // Stage 12 - Erfahrung sammeln
    {
      id: 34,
      software: [{ german: 'sammeln', persian: 'جمع کردن' }, { german: 'Erfahrung sammeln', persian: 'تجربه کسب کردن' }],
      promptFa: 'من تجربه کسب کردم.',
      expectedAnswer: 'Ich habe Erfahrung gesammelt.',
    },
    { id: 35, software: [{ german: 'praktische Erfahrung', persian: 'تجربه‌ی عملی' }], promptFa: 'من تجربه‌ی عملی کسب کردم.', expectedAnswer: 'Ich habe praktische Erfahrung gesammelt.' },
    {
      id: 36,
      software: [{ german: 'Workflow-Automatisierung', persian: 'اتوماسیون گردش کار' }],
      promptFa: 'من تجربه‌ی عملی در زمینه‌ی اتوماسیون گردش کار کسب کردم.',
      expectedAnswer: 'Ich habe praktische Erfahrung mit Workflow-Automatisierung gesammelt.',
    },
    {
      id: 37,
      software: [
        { german: 'Evaluation', persian: 'ارزیابی' },
        { german: 'KI-Agent', persian: 'عامل هوش مصنوعی' },
        { german: 'RAG-basiert', persian: 'مبتنی بر RAG' },
      ],
      promptFa: 'من تجربه‌ی عملی در زمینه‌ی اتوماسیون گردش کار و ارزیابی یک عامل هوش مصنوعی مبتنی بر RAG کسب کردم.',
      expectedAnswer: 'Ich habe praktische Erfahrung mit Workflow-Automatisierung und der Evaluation eines RAG-basierten KI-Agenten gesammelt.',
    },

    // Stage 13 - combine, fourth target sentence complete
    {
      id: 38,
      software: [],
      promptFa: 'من روی پروژه‌های نرم‌افزاری کار کردم و تجربه‌ی عملی کسب کردم.',
      expectedAnswer: 'Ich habe an Softwareprojekten gearbeitet und praktische Erfahrung gesammelt.',
    },
    {
      id: 39,
      software: [],
      promptFa: 'در این فرایند، من روی پروژه‌های نرم‌افزاری و موارد کاربرد مختلف هوش مصنوعی کار کردم و همچنین تجربه‌ی عملی در زمینه‌ی اتوماسیون گردش کار و ارزیابی یک عامل هوش مصنوعی مبتنی بر RAG کسب کردم.',
      expectedAnswer: 'Dabei habe ich an Softwareprojekten und verschiedenen KI-Use-Cases gearbeitet und auch praktische Erfahrung mit Workflow-Automatisierung und der Evaluation eines RAG-basierten KI-Agenten gesammelt.',
    },

    // Stage 14 - verbinden
    {
      id: 40,
      software: [{ german: 'verbinden', persian: 'ترکیب کردن' }, { german: 'Theorie', persian: 'تئوری' }, { german: 'Praxis', persian: 'عمل' }],
      promptFa: 'من تئوری را با عمل ترکیب می‌کنم.',
      expectedAnswer: 'Ich verbinde Theorie mit Praxis.',
    },
    {
      id: 41,
      software: [
        { german: 'Erfahrung aus der Lebensmittelindustrie', persian: 'تجربه از صنعت مواد غذایی' },
        { german: 'praktische Erfahrung im Bereich KI', persian: 'تجربه‌ی عملی در حوزه‌ی هوش مصنوعی' },
      ],
      promptFa: 'من تجربه از صنعت مواد غذایی را با تجربه‌ی عملی در حوزه‌ی هوش مصنوعی ترکیب می‌کنم.',
      expectedAnswer: 'Ich verbinde Erfahrung aus der Lebensmittelindustrie mit praktischer Erfahrung im Bereich KI.',
    },
    {
      id: 42,
      software: [],
      promptFa: 'من تجربه از صنعت مواد غذایی و مدیریت پروژه را با تجربه‌ی عملی در حوزه‌ی هوش مصنوعی ترکیب می‌کنم.',
      expectedAnswer: 'Ich verbinde Erfahrung aus der Lebensmittelindustrie und dem Projektmanagement mit praktischer Erfahrung im Bereich KI.',
    },
    {
      id: 43,
      software: [{ german: 'heute', persian: 'امروز' }],
      promptFa: 'امروز من تجربه از صنعت مواد غذایی و مدیریت پروژه را با تجربه‌ی عملی در حوزه‌ی هوش مصنوعی و محصولات دیجیتال ترکیب می‌کنم.',
      expectedAnswer: 'Ich verbinde heute Erfahrung aus der Lebensmittelindustrie und dem Projektmanagement mit praktischer Erfahrung im Bereich KI und digitale Produkte.',
    },
    {
      id: 44,
      software: [{ german: 'dadurch', persian: 'از این طریق' }],
      promptFa: 'از این طریق، من امروز تجربه از صنعت مواد غذایی و مدیریت پروژه را با تجربه‌ی عملی در حوزه‌ی هوش مصنوعی و محصولات دیجیتال ترکیب می‌کنم.',
      expectedAnswer: 'Dadurch verbinde ich heute Erfahrung aus der Lebensmittelindustrie und dem Projektmanagement mit praktischer Erfahrung im Bereich KI und digitale Produkte.',
    },

    // Stage 15 - etwas interessant finden, final sentence complete
    {
      id: 45,
      software: [
        { german: 'interessant', persian: 'جالب' },
        { german: 'finden', persian: 'دانستن (چیزی را ... دانستن)' },
        { german: 'Kombination', persian: 'ترکیب' },
      ],
      promptFa: 'من این ترکیب را جالب می‌دانم.',
      expectedAnswer: 'Ich finde diese Kombination interessant.',
    },
    { id: 46, software: [{ german: 'besonders', persian: 'به‌خصوص / خیلی' }], promptFa: 'من این ترکیب را به‌خصوص جالب می‌دانم.', expectedAnswer: 'Ich finde diese Kombination besonders interessant.' },
    {
      id: 47,
      software: [{ german: 'bei dieser Stelle', persian: 'در مورد این موقعیت شغلی' }],
      promptFa: 'من این ترکیب را در مورد این موقعیت شغلی به‌خصوص جالب می‌دانم.',
      expectedAnswer: 'Ich finde diese Kombination bei dieser Stelle besonders interessant.',
    },
    {
      id: 48,
      software: [{ german: 'auch', persian: 'نیز / هم' }],
      promptFa: 'من این ترکیب را در مورد این موقعیت شغلی هم به‌خصوص جالب می‌دانم.',
      expectedAnswer: 'Ich finde diese Kombination auch bei dieser Stelle besonders interessant.',
    },
    {
      id: 49,
      software: [{ german: 'genau diese Kombination', persian: 'دقیقاً همین ترکیب' }],
      promptFa: 'دقیقاً همین ترکیب را من در مورد این موقعیت شغلی هم به‌خصوص جالب می‌دانم.',
      expectedAnswer: 'Genau diese Kombination finde ich auch bei dieser Stelle besonders interessant.',
    },
  ],
};
