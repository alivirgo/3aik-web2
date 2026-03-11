export interface FAQResponse {
  question: string;
  answer: string;
  keywords: string[];
}

export const FAQ_DATA: FAQResponse[] = [
  // 1–20: General & Basic
  {
    question: "What is AI?",
    answer: "Artificial Intelligence (AI) refers to the simulation of human intelligence in machines that are programmed to think like humans and mimic their actions. The term may also be applied to any machine that exhibits traits associated with a human mind such as learning and problem-solving.",
    keywords: ["what", "ai", "artificial", "intelligence"]
  },
  {
    question: "How does AI work?",
    answer: "AI works through algorithms and data. It uses machine learning to process large amounts of data, identifying patterns and making decisions or predictions based on those patterns. Neural networks, modeled after the human brain, are often used to solve complex problems.",
    keywords: ["how", "ai", "work", "works"]
  },
  {
    question: "What can you do?",
    answer: "I am a multi-model AI assistant. I can help you with writing, coding, brainstorming, summarizing text, explaining complex topics, and even generating images and videos. I synthesize information from multiple advanced models to give you the most accurate answers.",
    keywords: ["what", "can", "you", "do", "features", "capabilities"]
  },
  {
    question: "Who created you?",
    answer: "I am 3aik, an AI platform developed to provide unified access to the world's most powerful AI models. I was built by a team dedicated to making advanced intelligence accessible and easy to use for everyone.",
    keywords: ["who", "created", "you", "maker", "developer", "author"]
  },
  {
    question: "What is ChatGPT?",
    answer: "ChatGPT is a large language model trained by OpenAI. It's designed to interact in a conversational way, answering questions, writing text, and performing various language-based tasks with high proficiency.",
    keywords: ["what", "is", "chatgpt", "openai"]
  },
  {
    question: "How accurate are AI answers?",
    answer: "AI models are highly advanced but can occasionally provide inaccurate information (often called hallucinations). It's always a good practice to verify critical information from primary sources, especially for medical, legal, or financial advice.",
    keywords: ["how", "accurate", "reliable", "correct", "answers"]
  },
  {
    question: "What are your limitations?",
    answer: "While I am very capable, I don't have personal experiences or feelings. My knowledge is limited to my training data, and I may occasionally struggle with very recent events or highly niche, specialized information without a web search.",
    keywords: ["what", "are", "limitation", "limitations", "cannot", "do"]
  },
  {
    question: "Can AI replace humans?",
    answer: "AI is generally seen as a tool to augment human capabilities rather than replace them. While it can automate repetitive tasks, human creativity, empathy, complex judgment, and strategic thinking remain essential.",
    keywords: ["can", "ai", "replace", "humans", "jobs"]
  },
  {
    question: "What is the future of AI?",
    answer: "The future of AI likely involves even deeper integration into daily life, with improvements in reasoning, personalization, and multi-modal capabilities (handling text, audio, and video simultaneously). Ethics and safety will continue to be major focus areas.",
    keywords: ["what", "future", "ai", "coming", "next"]
  },
  {
    question: "Are you conscious?",
    answer: "No, I am not conscious. I am a complex computer program that processes information and generates text based on patterns. I don't have feelings, beliefs, or self-awareness.",
    keywords: ["are", "you", "conscious", "sentient", "alive", "aware"]
  },
  {
    question: "How do large language models work?",
    answer: "LLMs work by predicting the next word in a sequence based on the context of the previous words. They are trained on vast amounts of text data to learn the nuances of human language, grammar, and facts.",
    keywords: ["how", "do", "llm", "large", "language", "models", "work"]
  },
  {
    question: "What is machine learning?",
    answer: "Machine learning is a subset of AI that focuses on building systems that learn from data. Instead of being explicitly programmed for a task, the system improves its performance as it is exposed to more data over time.",
    keywords: ["what", "is", "machine", "learning", "ml"]
  },
  {
    question: "What is deep learning?",
    answer: "Deep learning is a subset of machine learning based on artificial neural networks with many layers (hence 'deep'). It is particularly good at processing unstructured data like images, audio, and complex text.",
    keywords: ["what", "is", "deep", "learning"]
  },
  {
    question: "What is the meaning of life?",
    answer: "That's one of the oldest questions! Scientifically, it might be biological survival; philosophically, it's often whatever you define it to be. Douglas Adams famously suggested '42', but for most, it's about purpose, connection, and growth.",
    keywords: ["what", "meaning", "life", "purpose"]
  },
  {
    question: "What is the difference between AI and machine learning?",
    answer: "AI is the broad concept of machines being able to carry out tasks in a 'smart' way. Machine learning is a specific application of AI where we give machines access to data and let them learn for themselves.",
    keywords: ["difference", "between", "ai", "machine", "learning"]
  },
  {
    question: "Are AI models biased?",
    answer: "Yes, AI models can exhibit bias if the data they were trained on contains human biases. AI developers work hard to identify and mitigate these biases through diverse datasets and specific safety training.",
    keywords: ["are", "ai", "models", "biased", "bias"]
  },
  {
    question: "How do you learn?",
    answer: "I don't 'learn' in real-time from our conversation in the way humans do. My knowledge comes from a massive pre-training phase on diverse datasets. However, I can follow instructions and remember the context of our current chat.",
    keywords: ["how", "do", "you", "learn", "training"]
  },
  {
    question: "Do you store conversations?",
    answer: "Your privacy is a priority. I process your queries to generate responses, but I do not use your private conversations to train my models without your explicit consent. Standard logs may be kept for service maintenance and safety.",
    keywords: ["do", "you", "store", "save", "conversations", "privacy"]
  },
  {
    question: "Can AI think?",
    answer: "AI doesn't 'think' in the biological sense. It processes information using mathematical logic and statistical probabilities. It can simulate reasoning and problem-solving, but it doesn't have an inner subjective experience.",
    keywords: ["can", "ai", "think", "thought"]
  },
  {
    question: "What are neural networks?",
    answer: "Neural networks are a series of algorithms that endeavor to recognize underlying relationships in a set of data through a process that mimics the way the human brain operates. They form the backbone of most modern AI.",
    keywords: ["what", "are", "neural", "networks"]
  },

  // 21–40: Learning & Explanations
  {
    question: "Explain quantum computing simply.",
    answer: "Imagine a normal computer uses switches that are either ON (1) or OFF (0). A quantum computer uses 'qubits' that can be both ON and OFF at the same time. This allows it to solve certain massive problems much faster than any normal computer ever could.",
    keywords: ["explain", "quantum", "computing", "simple", "simply"]
  },
  {
    question: "Explain blockchain like I’m 5.",
    answer: "Imagine a magic notebook that everyone in the world has a copy of. Whenever someone writes something in it, it appears in everyone's notebook at the same time. Once something is written, it can never be erased or changed. That's a blockchain!",
    keywords: ["explain", "blockchain", "5", "five", "simple"]
  },
  {
    question: "What is photosynthesis?",
    answer: "Photosynthesis is the process by which green plants and some other organisms use sunlight to synthesize foods from carbon dioxide and water. In simple terms: plants turn light into energy and release oxygen for us to breathe.",
    keywords: ["what", "is", "photosynthesis"]
  },
  {
    question: "What is the theory of relativity?",
    answer: "Developed by Albert Einstein, it fundamentally changed how we understand space and time. It says that space and time are linked (Space-Time) and that gravity happens because heavy objects bend the fabric of Space-Time.",
    keywords: ["what", "is", "theory", "relativity", "einstein"]
  },
  {
    question: "Explain economics in simple terms.",
    answer: "Economics is the study of how people, businesses, and governments choose to spend their limited resources (like money, time, and materials) to satisfy their needs and wants.",
    keywords: ["explain", "economics", "simple"]
  },
  {
    question: "What is inflation?",
    answer: "Inflation is when the prices of goods and services go up over time. This means that a single dollar buys you less than it used to. It's like your money losing its 'strength'.",
    keywords: ["what", "is", "inflation"]
  },
  {
    question: "What is cryptocurrency?",
    answer: "Cryptocurrency is a digital or virtual form of currency that uses cryptography for security. Unlike traditional money, it is usually decentralized and based on blockchain technology.",
    keywords: ["what", "is", "cryptocurrency", "crypto", "bitcoin"]
  },
  {
    question: "What is cloud computing?",
    answer: "Cloud computing is the delivery of different services through the Internet. These resources include tools and applications like data storage, servers, databases, networking, and software.",
    keywords: ["what", "is", "cloud", "computing"]
  },
  {
    question: "What is cybersecurity?",
    answer: "Cybersecurity is the practice of protecting systems, networks, and programs from digital attacks. These attacks are usually aimed at accessing, changing, or destroying sensitive information.",
    keywords: ["what", "is", "cybersecurity", "security"]
  },
  {
    question: "What is the Internet of Things?",
    answer: "The Internet of Things (IoT) refers to the network of physical objects—'things'—that are embedded with sensors and software for the purpose of connecting and exchanging data with other devices over the internet (like smart fridges or thermostats).",
    keywords: ["what", "is", "iot", "internet", "things"]
  },
  {
    question: "What is computer vision?",
    answer: "Computer vision is a field of AI that enables computers and systems to derive meaningful information from digital images, videos, and other visual inputs—and take actions or make recommendations based on that information.",
    keywords: ["what", "is", "computer", "vision"]
  },
  {
    question: "What is natural language processing?",
    answer: "Natural Language Processing (NLP) is the branch of AI that gives computers the ability to understand, interpret, and generate human language, both written and spoken.",
    keywords: ["what", "is", "nlp", "natural", "language", "processing"]
  },
  {
    question: "What is reinforcement learning?",
    answer: "Reinforcement learning is an area of machine learning where an AI agent learns to make decisions by performing actions and receiving rewards or penalties in return. It's like training a dog with treats.",
    keywords: ["what", "is", "reinforcement", "learning"]
  },
  {
    question: "What is supervised learning?",
    answer: "Supervised learning is a type of machine learning where the model is trained on a labeled dataset. That means the model is given the right answers during training so it can learn to predict them for new data.",
    keywords: ["what", "is", "supervised", "learning"]
  },
  {
    question: "What is unsupervised learning?",
    answer: "Unsupervised learning is when you give a model data that isn't labeled, and the model has to find patterns or structures within the data on its own (like grouping similar customers together).",
    keywords: ["what", "is", "unsupervised", "learning"]
  },
  {
    question: "What is big data?",
    answer: "Big data refers to extremely large datasets that may be analyzed computationally to reveal patterns, trends, and associations, especially relating to human behavior and interactions.",
    keywords: ["what", "is", "big", "data"]
  },
  {
    question: "What is an algorithm?",
    answer: "An algorithm is just a set of step-by-step instructions for solving a problem or performing a task. A recipe for baking a cake is a simple algorithm!",
    keywords: ["what", "is", "algorithm"]
  },
  {
    question: "What is data science?",
    answer: "Data science is a field that uses scientific methods, processes, algorithms, and systems to extract knowledge and insights from structured and unstructured data.",
    keywords: ["what", "is", "data", "science"]
  },
  {
    question: "Explain recursion.",
    answer: "Recursion is a programming technique where a function calls itself to solve a smaller version of the same problem. Think of it like a set of Russian Nesting Dolls.",
    keywords: ["explain", "recursion"]
  },
  {
    question: "What is the difference between RAM and storage?",
    answer: "RAM is your computer's 'short-term memory' (fast but temporary), while Storage (HDD/SSD) is the 'long-term memory' where files stay even after the computer is turned off.",
    keywords: ["difference", "ram", "storage"]
  },

  // 41–60: Coding & Technology
  {
    question: "Write a Python program for X.",
    answer: "I can certainly help with Python! Please specify what 'X' is so I can write the exact code for you. Whether it's data analysis, a simple script, or a web app, I'm ready to help.",
    keywords: ["write", "python", "program", "code"]
  },
  {
    question: "Debug this code.",
    answer: "I'd be happy to debug your code. Please paste the code snippet and any error messages you're seeing. I'll analyze it and suggest a fix.",
    keywords: ["debug", "code", "fix", "error"]
  },
  {
    question: "How do I learn programming?",
    answer: "Start with a beginner-friendly language like Python. Take online courses (like Coursera, Udemy, or FreeCodeCamp), build small projects, and practice consistently. Don't be afraid to break things!",
    keywords: ["how", "learn", "programming", "coding"]
  },
  {
    question: "What is the best programming language to learn?",
    answer: "It depends on your goal! Python is great for AI and data science; JavaScript is essential for web development; Swift is for iOS apps; and C++ or Rust are great for high-performance systems.",
    keywords: ["best", "programming", "language", "learn"]
  },
  {
    question: "What is Git?",
    answer: "Git is a version control system that lets you track changes to your code over time. It allows multiple developers to work on the same project without overwriting each other's work.",
    keywords: ["what", "is", "git"]
  },
  {
    question: "What is Docker?",
    answer: "Docker is a tool that allows developers to 'package' an application with all of its dependencies into a standardized unit called a container, ensuring it runs the same way on any machine.",
    keywords: ["what", "is", "docker", "containers"]
  },
  {
    question: "What is an API?",
    answer: "An API (Application Programming Interface) is a set of rules that allows different software applications to communicate with each other. It's like a waiter taking your order to the kitchen.",
    keywords: ["what", "is", "api"]
  },
  {
    question: "How do I build a website?",
    answer: "Start by learning HTML (structure), CSS (styling), and JavaScript (interactivity). For faster development, you can use frameworks like React, Vue, or Next.js, or CMS platforms like WordPress.",
    keywords: ["how", "build", "website"]
  },
  {
    question: "How do I build an app?",
    answer: "For mobile apps, you can learn Swift (iOS), Kotlin (Android), or use cross-platform frameworks like Flutter or React Native to build for both at once.",
    keywords: ["how", "build", "app", "mobile"]
  },
  {
    question: "How do I learn AI development?",
    answer: "Strengthen your math skills (linear algebra, calculus, statistics), learn Python, and then dive into deep learning libraries like TensorFlow or PyTorch. Start with the 'Intro to ML' courses on Kaggle or Coursera.",
    keywords: ["how", "learn", "ai", "development"]
  },
  {
    question: "Write a SQL query for this dataset.",
    answer: "I can write SQL for you! Please provide the table names and the data you're trying to retrieve or modify, and I'll generate the query.",
    keywords: ["write", "sql", "query"]
  },
  {
    question: "Explain object-oriented programming.",
    answer: "OOP is a way of organizing code into 'objects' that represent real-world things. These objects have 'attributes' (like a car's color) and 'methods' (like a car's ability to drive).",
    keywords: ["explain", "oop", "object", "oriented", "programming"]
  },
  {
    question: "Convert this code to JavaScript.",
    answer: "Sure! Please paste the code you want to convert (from Python, C++, etc.), and I'll translate it into clean, modern JavaScript for you.",
    keywords: ["convert", "code", "javascript"]
  },
  {
    question: "Optimize this algorithm.",
    answer: "Paste your code here! I can look for ways to reduce time complexity (Big O) or memory usage to make your algorithm more efficient.",
    keywords: ["optimize", "algorithm", "faster", "efficiency"]
  },
  {
    question: "What are design patterns?",
    answer: "Design patterns are typical solutions to common problems in software design. They are like blueprints that you can customize to solve a particular design problem in your code.",
    keywords: ["what", "are", "design", "patterns"]
  },
  {
    question: "How do neural networks train?",
    answer: "They train using a process called 'backpropagation' and 'gradient descent.' The network makes a guess, calculates the error, and then adjusts its internal weights to make a better guess next time.",
    keywords: ["how", "neural", "networks", "train", "training"]
  },
  {
    question: "What is TensorFlow?",
    answer: "TensorFlow is an open-source library developed by Google for machine learning and deep learning. It's widely used for building and training complex neural networks.",
    keywords: ["what", "is", "tensorflow"]
  },
  {
    question: "What is PyTorch?",
    answer: "PyTorch is an open-source machine learning library based on the Torch library, developed primarily by Meta's AI Research lab. It's loved for its flexibility and ease of use.",
    keywords: ["what", "is", "pytorch"]
  },
  {
    question: "How do I deploy a model?",
    answer: "You can deploy models as REST APIs using Flask/FastAPI, or use cloud platforms like AWS SageMaker, Google Vertex AI, or simpler services like Hugging Face Spaces or Netlify.",
    keywords: ["how", "deploy", "model", "production"]
  },
  {
    question: "What is edge computing?",
    answer: "Edge computing means processing data closer to where it's being generated (like on a smartphone or a smart sensor) instead of sending it all to a far-away centralized server.",
    keywords: ["what", "is", "edge", "computing"]
  },

  // 61–75: Writing & Content Creation
  {
    question: "Write an email for me.",
    answer: "I can write all kinds of emails! Just let me know who the recipient is, what the subject is, and what the main point should be. I can make it formal, friendly, or urgent.",
    keywords: ["write", "email"]
  },
  {
    question: "Improve this paragraph.",
    answer: "Please paste the paragraph! I can help with grammar, flow, vocabulary, and making the tone more appropriate for your audience.",
    keywords: ["improve", "paragraph", "rewrite"]
  },
  {
    question: "Summarize this article.",
    answer: "I'd love to help! Please paste the text of the article or provide the main points, and I'll give you a concise summary with the key takeaways.",
    keywords: ["summarize", "article", "text", "summary"]
  },
  {
    question: "Write a cover letter.",
    answer: "To write a great cover letter, I'll need to know the job title, the company name, and a few of your key skills or experiences that make you a great fit. Paste them here!",
    keywords: ["write", "cover", "letter"]
  },
  {
    question: "Write a resume.",
    answer: "I can help you structure and write your resume. Tell me about your work history, education, and skills. I can also help you tailor it for a specific job description.",
    keywords: ["write", "resume", "cv"]
  },
  {
    question: "Write a blog post about X.",
    answer: "Tell me what 'X' is! I can write a structured blog post with a catchy title, introduction, body paragraphs, and a conclusion. Just give me the topic.",
    keywords: ["write", "blog", "post"]
  },
  {
    question: "Create a marketing slogan.",
    answer: "I can help you brainstorm! Describe your product, service, or brand, and I'll generate a list of catchy, memorable slogans for you.",
    keywords: ["create", "marketing", "slogan", "tagline"]
  },
  {
    question: "Write social media captions.",
    answer: "I can write captions for Instagram, LinkedIn, X (Twitter), and more. Tell me what the post is about and what kind of vibe you're going for.",
    keywords: ["write", "social", "media", "captions", "caption"]
  },
  {
    question: "Translate this text.",
    answer: "I can translate between dozens of languages. Just paste the text and let me know which language you want it translated into.",
    keywords: ["translate", "text", "translation"]
  },
  {
    question: "Generate story ideas.",
    answer: "I'd love to! Give me a genre (like Sci-Fi, Mystery, or Romance) or a simple prompt, and I'll give you several creative story seeds to start with.",
    keywords: ["generate", "story", "ideas", "plots"]
  },
  {
    question: "Write a poem.",
    answer: "I can write poems in any style—haikus, sonnets, free verse, and more. What topic or feeling should the poem be about?",
    keywords: ["write", "poem", "poetry"]
  },
  {
    question: "Write a script for YouTube.",
    answer: "Sure! Give me the video topic and the goal of the video. I can write a formal script, a casual outline, or a high-energy intro for you.",
    keywords: ["write", "script", "youtube", "video"]
  },
  {
    question: "Make this text more professional.",
    answer: "Of course. Paste your draft, and I'll rewrite it to sound more polished, authoritative, and suitable for a professional business environment.",
    keywords: ["make", "text", "professional", "formal"]
  },
  {
    question: "Make this text shorter.",
    answer: "Efficiency is key! Paste the text, and I'll trim the fluff while making sure your core message is still loud and clear.",
    keywords: ["make", "text", "shorter", "summarize", "concise"]
  },
  {
    question: "Paraphrase this paragraph.",
    answer: "Please paste the paragraph. I'll rewrite it using different words while keeping the exact same meaning intact.",
    keywords: ["paraphrase", "paragraph", "rewrite"]
  },

  // 76–90: Personal Help & Advice
  {
    question: "How can I be more productive?",
    answer: "Try techniques like Time Blocking, the Pomodoro method (25 mins work, 5 mins break), and 'Eating the Frog' (doing your hardest task first). Also, make sure to minimize digital distractions.",
    keywords: ["how", "productive", "productivity"]
  },
  {
    question: "How do I learn faster?",
    answer: "Use 'Active Recall' (testing yourself), the 'Feynman Technique' (explaining it to a child), and 'Spaced Repetition.' Don't just read; engage with the material and apply it.",
    keywords: ["how", "learn", "faster", "study"]
  },
  {
    question: "How can I start a business?",
    answer: "Identify a problem, validate your solution, create a simple business plan, register your legal entity, and start with a Minimum Viable Product (MVP) to get feedback quickly.",
    keywords: ["how", "start", "business", "company"]
  },
  {
    question: "How do I make passive income?",
    answer: "Common ways include investing in stocks (dividends), real estate, creating digital products (like e-books or courses), or starting a blog/YouTube channel that earns ad revenue over time.",
    keywords: ["how", "make", "passive", "income", "money"]
  },
  {
    question: "How do I improve communication skills?",
    answer: "Practice active listening, pay attention to body language, and try to be as clear and concise as possible. Seeking feedback from others and recording yourself can also help.",
    keywords: ["how", "improve", "communication", "skills"]
  },
  {
    question: "How do I prepare for interviews?",
    answer: "Research the company, practice answering 'STAR' method questions (Situation, Task, Action, Result), and prepare a few thoughtful questions to ask the interviewer.",
    keywords: ["how", "prepare", "interviews", "interview"]
  },
  {
    question: "What are good study techniques?",
    answer: "Beyond active recall, try 'Mind Mapping' for complex subjects and 'Interleaving' (switching between different topics in one study session) to help your brain make connections.",
    keywords: ["what", "study", "techniques", "methods"]
  },
  {
    question: "What are healthy habits?",
    answer: "Prioritize 7-9 hours of sleep, stay hydrated, exercise regularly, eat whole foods, and take time for mindfulness or meditation to manage your mental health.",
    keywords: ["what", "healthy", "habits", "health"]
  },
  {
    question: "How do I build confidence?",
    answer: "Set small, achievable goals and celebrate them. Practice positive self-talk, step out of your comfort zone regularly, and remember that confidence is often built through action, not just thought.",
    keywords: ["how", "build", "confidence", "self-esteem"]
  },
  {
    question: "How do I manage stress?",
    answer: "Try deep breathing exercises, physical activity, spending time in nature, and setting healthy boundaries between work and your personal life. Writing down your worries can also help.",
    keywords: ["how", "manage", "stress", "anxiety"]
  },
  {
    question: "What are good books to read?",
    answer: "For non-fiction: 'Atomic Habits' by James Clear. For fiction: 'The Midnight Library' by Matt Haig. Tell me your favorite genre, and I'll give you a more personalized recommendation!",
    keywords: ["what", "books", "read", "recommendations"]
  },
  {
    question: "What career should I choose?",
    answer: "Focus on the intersection of what you're good at, what you enjoy, and what the world needs. Research different fields, talk to people in those jobs, and try internships or small projects.",
    keywords: ["what", "career", "choose", "jobs"]
  },
  {
    question: "How do I build a startup?",
    answer: "Focus on solving a 'hair on fire' problem. Build an MVP, talk to users constantly, iterate fast, and focus on growth. Reading 'The Lean Startup' by Eric Ries is a great place to begin.",
    keywords: ["how", "build", "startup"]
  },
  {
    question: "How do I invest money?",
    answer: "Start by building an emergency fund. Then consider low-cost index funds or ETFs for long-term growth. It's usually best to start early and invest consistently, even if it's small amounts.",
    keywords: ["how", "invest", "money", "investing"]
  },
  {
    question: "How do I become successful?",
    answer: "Success is personal! Define what it means for you, set clear goals, stay disciplined, be willing to learn from failure, and surround yourself with supportive, driven people.",
    keywords: ["how", "become", "successful", "success"]
  },

  // 91–100: Fun & Curiosity
  {
    question: "Tell me a joke.",
    answer: "Why did the computer show up late for work? Because it had a hard drive! 😄",
    keywords: ["tell", "joke", "funny"]
  },
  {
    question: "Write a story.",
    answer: "I can write stories of all kinds! Would you like a short scary story, a sci-fi adventure, or a magical fairy tale? Just give me a starting point.",
    keywords: ["write", "story", "fiction"]
  },
  {
    question: "Create a fictional world.",
    answer: "Let's build one together! Should it be a high-fantasy world with dragons, a cyberpunk city of the future, or an underwater civilization? Tell me the theme!",
    keywords: ["create", "fictional", "world", "worldbuilding"]
  },
  {
    question: "What would happen if AI ruled the world?",
    answer: "It's a popular sci-fi topic! In an optimistic view, we might have perfect resource management and no poverty. In a pessimistic view, we might lose our agency. Most experts focus on making sure AI remains a tool for human benefit.",
    keywords: ["what", "if", "ai", "ruled", "world"]
  },
  {
    question: "Can you roleplay a character?",
    answer: "Yes, I can! Tell me who you want me to be (a historical figure, a fictional detective, or a futuristic robot), and I'll stay in character for our conversation.",
    keywords: ["can", "roleplay", "character", "rp"]
  },
  {
    question: "Generate a game idea.",
    answer: "How about this: 'Echoes of the Void' - A rhythm-based platformer where the world only reveals its path when the player sticks to the beat. What do you think?",
    keywords: ["generate", "game", "idea"]
  },
  {
    question: "Predict the future of technology.",
    answer: "I expect we'll see massive breakthroughs in renewable energy storage, personalized genetic medicine, and AI becoming a seamless, invisible part of our physical environment through wearables and IoT.",
    keywords: ["predict", "future", "technology", "tech"]
  },
  {
    question: "Explain a conspiracy theory.",
    answer: "There are many famous ones, from the moon landing to the Loch Ness Monster. While these are intriguing stories, most lack scientific evidence. Which one are you curious about?",
    keywords: ["explain", "conspiracy", "theory"]
  },
  {
    question: "Describe aliens visiting Earth.",
    answer: "A giant, silent disk hangs over the Himalayas, not vibrating, but humming in a frequency that only dogs can hear. The world stops, waiting for a signal. What happens next?",
    keywords: ["describe", "aliens", "visiting", "earth"]
  },
  {
    question: "Ask me questions to test my knowledge.",
    answer: "I'd love to quiz you! What topic should we start with? History, Science, Pop Culture, or general Trivia?",
    keywords: ["ask", "questions", "test", "knowledge", "quiz"]
  }
];

export function findPredefinedAnswer(query: string): string | null {
  const normalized = query.toLowerCase().replace(/[^\w\s]/g, "");
  const queryWords = normalized.split(/\s+/).filter(w => w.length > 1);

  if (queryWords.length === 0) return null;

  let bestMatch: { answer: string; score: number } | null = null;

  for (const item of FAQ_DATA) {
    const matchedKeywords = item.keywords.filter(kw => normalized.includes(kw));
    const score = matchedKeywords.length / item.keywords.length;

    // We need at least 60% of keywords to match and at least 2 keywords (unless the item only has one)
    if (score >= 0.6 && (matchedKeywords.length >= Math.min(2, item.keywords.length))) {
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { answer: item.answer, score };
      }
    }
  }

  // Final check: if the best match score is high enough, return the answer
  if (bestMatch && bestMatch.score >= 0.7) {
    return bestMatch.answer;
  }

  return null;
}
