import express from 'express';
import dotenv from 'dotenv';
import { promisify } from 'util';
import { exec } from 'child_process';
import { Octokit } from '@octokit/rest';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import session from 'express-session';
import pg from 'pg';
import fs from 'fs/promises';
import OpenAI from 'openai';
import winston from 'winston';
import cors from 'cors';
import path from 'path';
import util from 'util';
import { parseISO, format, addDays, isAfter } from 'date-fns';


// Initialize environment variables
dotenv.config();

// Promisify exec for async/await
const execPromise = (cmd, options = {}) => util.promisify(exec)(cmd, { maxBuffer: 50 * 1024 * 1024, ...options });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());


const sinceDate = "2025-01-29";
const untilDate = "2025-02-05";
//const untilDate = new Date().toISOString().slice(0, 10);



// CORS configuration
const allowedOrigins = [
  'http://localhost:5000', 
  'http://127.0.0.1:5000', 
  'http://172.19.0.4:5000', 
  'http://localhost:3000',
  'http://192.168.56.1:4000',
  'http://localhost:4000'

]; // Replace with your frontend URL
app.use(cors({
  origin: function(origin, callback){
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }, 
  credentials: true, // Allow credentials (cookies)
}));

// Set up session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET, // Use environment variable
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true in production with HTTPS
  })
);

// Database configuration
const pool = new pg.Pool({
  connectionString: `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
});

// Test and initialize database
pool
  .connect()
  .then(() => {
    console.log('Successfully connected to database');
    return initializeDatabase();
  })
  .catch((err) => {
    console.error('Database connection error:', err);
    process.exit(1); // Exit if we can't connect to the database
  });

// Initialize database schema
async function initializeDatabase() {
  try {
    await pool.query(`
      -- Ensure the pgvector and pgvectorscale extensions are installed
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE EXTENSION IF NOT EXISTS vectorscale;

      CREATE TABLE IF NOT EXISTS code_analysis (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        repo_url TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        commits JSONB DEFAULT '{}',
        file_changes JSONB DEFAULT '{}',
        contributors JSONB DEFAULT '{}',
        commit_activity JSONB DEFAULT '{}',
        dependencies JSONB DEFAULT '{}',
        blame_by_day JSONB DEFAULT '{}',
        issues JSONB DEFAULT '{}',
        UNIQUE(session_id, repo_url)
      );

      -- Create the commit_embeddings table with the correct vector dimensions
      CREATE TABLE IF NOT EXISTS commit_embeddings (
        id BIGSERIAL PRIMARY KEY,
        code_analysis_id BIGINT REFERENCES code_analysis(id),
        commit_hash TEXT NOT NULL,
        commit_message TEXT NOT NULL,
        embedding VECTOR(768), -- Adjusted to match LLM embedding size
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(code_analysis_id, commit_hash)
      );

      -- Create vector similarity search index using diskann
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'commit_embeddings_idx'
        ) THEN
          CREATE INDEX commit_embeddings_idx
          ON commit_embeddings USING diskann (embedding);
        END IF;
      END$$;
    `);

    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Initialize Octokit for GitHub API access
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper function to extract owner and repo from URL
function extractRepoInfo(repoUrl) {
  //const match = repoUrl.match(/github\.com\/([\w-]+)\/([\w-]+)/);
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)(?:\.git)?$/);
  if (match) {
    const owner = match[1];
    const repo = match[2];  // let pour pouvoir modifier
    //console.log(`Extracted owner: ${owner}, repo: ${repo} from URL: ${repoUrl}`);
    return { owner, repo };
  } else {
    throw new Error('Invalid GitHub repository URL');
  }
}

// Fetch total commit count
async function getTotalCommitCount(owner, repo) {
  let totalCommits = 0;
  let page = 1;
  const perPage = 100;

  try {
    while (true) {
      const response = await octokit.repos.listCommits({
        owner,
        repo,
        per_page: perPage,
        page,
      });

      totalCommits += response.data.length;

      if (response.data.length < perPage) {
        break;
      }
      page++;
    }
    return totalCommits;
  } catch (error) {
    console.error('Error fetching total commit count:', error.message);
    throw error;
  }
}

async function getTotalCommitCountAllBranches(owner, repo, local) {
  if (local) {
    try {
      const repoPath = `/app/clones/${repo}`; 
      // Liste branches locales
      const { stdout: branchListStdout } = await execPromise(`git -C ${repoPath} branch -r`);      
      const branches = branchListStdout
        .split('\n')
        .map(b => b.trim())
        .filter(b => b && !b.includes('HEAD')) // enlever HEAD -> origin/HEAD -> origin/main
        .map(b => b.replace(/^origin\//, ''));

      let totalCommits = 0;
      for (const branch of branches) {
        // compter commits pour chaque branche
        const { stdout: countStdout } = await execPromise(`git -C ${repoPath} rev-list --count ${branch}`);
        totalCommits += parseInt(countStdout.trim(), 10);
      }
      return totalCommits;
    } catch (error) {
      console.error('Error getting total commits locally:', error);
      return 0;
    }
  } else {
    // version API GitHub
    const branches = await octokit.repos.listBranches({ owner, repo });
    let totalCommits = 0;

    for (const branch of branches.data) {
      const commits = await octokit.paginate(octokit.repos.listCommits, {
        owner,
        repo,
        sha: branch.name,
        per_page: 100,
      });
      totalCommits += commits.length;
    }

    return totalCommits;
  }
}



// Fetch contributors
async function fetchContributors(owner, repo, local) {
  let contributors = [];
  let page = 1;
  const perPage = 100;

  try {
    while (true) {
      const response = await octokit.repos.listContributors({
        owner,
        repo,
        per_page: perPage,
        page,
      });

      contributors = contributors.concat(response.data);

      if (response.data.length < perPage) {
        break;
      }
      page++;
    }
    return contributors;
  } catch (error) {
    console.error('Error fetching contributors:', error.message);
    throw error;
  }
  
}


async function fetchCommitActivityAllBranches(owner, repo, local) {
  if (local) {
    try {
      const repoPath = `/app/clones/${repo}`;

      const { stdout: branchesStdout } = await execPromise(`git -C ${repoPath} branch -a --format="%(refname:short)"`);
      const branches = branchesStdout
        .split('\n')
        .map(b => b.trim())
        .filter(b => b.length > 0);

      const dailyCommitsMap = new Map();
      const seenCommits = new Set(); // ← évite les doublons

      for (const branch of branches) {
        const { stdout: commitsStdout } = await execPromise(
          `git -C ${repoPath} log ${branch} --since="${sinceDate}" --until="${untilDate}" --pretty=format:"%H|%aI|%ae"`
        );

        const lines = commitsStdout.split('\n').filter(line => line.length > 0);

        for (const line of lines) {
          const [hash, dateStr, email] = line.split('|');

          if (seenCommits.has(hash)) continue;
          seenCommits.add(hash);

          const date = new Date(dateStr);
          if (isNaN(date)) continue;

          const dayStr = date.toISOString().slice(0, 10);

          if (!dailyCommitsMap.has(dayStr)) {
            dailyCommitsMap.set(dayStr, new Map());
          }

          const contributorMap = dailyCommitsMap.get(dayStr);
          contributorMap.set(email, (contributorMap.get(email) || 0) + 1);
        }
      }

      const dailyCommitsObj = {};
      for (const [day, contributors] of dailyCommitsMap.entries()) {
        dailyCommitsObj[day] = {};
        for (const [contributor, count] of contributors.entries()) {
          dailyCommitsObj[day][contributor] = count;
        }
      }

      return dailyCommitsObj;
    } catch (error) {
      console.error('Error fetching commit activity locally:', error);
      return {};
    }
  } else {
    try {
      const branchesResponse = await octokit.repos.listBranches({
        owner,
        repo,
        per_page: 100,
      });
      const branches = branchesResponse.data;

      const dailyCommitsMap = new Map();
      const seenCommits = new Set();

      for (const branch of branches) {
        const commits = await octokit.paginate(octokit.repos.listCommits, {
          owner,
          repo,
          sha: branch.name,
          per_page: 100,
        });

        for (const commit of commits) {
          const hash = commit.sha;
          if (seenCommits.has(hash)) continue;
          seenCommits.add(hash);

          const dateStr = commit.commit.author.date;
          const email = commit.commit.author.email || 'unknown';
          const date = new Date(dateStr);
          if (isNaN(date)) continue;

          const dayStr = date.toISOString().slice(0, 10);

          if (!dailyCommitsMap.has(dayStr)) {
            dailyCommitsMap.set(dayStr, new Map());
          }

          const contributorMap = dailyCommitsMap.get(dayStr);
          contributorMap.set(email, (contributorMap.get(email) || 0) + 1);
        }
      }

      const dailyCommitsObj = {};
      for (const [day, contributors] of dailyCommitsMap.entries()) {
        dailyCommitsObj[day] = {};
        for (const [contributor, count] of contributors.entries()) {
          dailyCommitsObj[day][contributor] = count;
        }
      }

      return dailyCommitsObj;
    } catch (error) {
      console.error('Error fetching commit activity for all branches:', error);
      return {};
    }
  }
}




// Fetch file changes
async function fetchFileChanges(owner, repo) {
  let page = 1;
  const perPage = 100;
  const fileChangeCounts = {};

  try {
    while (true) {
      const response = await octokit.repos.listCommits({
        owner,
        repo,
        per_page: perPage,
        page,
      });

      if (response.data.length === 0) {
        break;
      }

      for (const commit of response.data) {
        const commitDetails = await octokit.repos.getCommit({
          owner,
          repo,
          ref: commit.sha,
        });

        for (const file of commitDetails.data.files) {
          fileChangeCounts[file.filename] = (fileChangeCounts[file.filename] || 0) + 1;
        }
      }

      if (response.data.length < perPage) {
        break;
      }
      page++;
    }

    return fileChangeCounts;
  } catch (error) {
    console.error('Error fetching file changes:', error);
    return {};
  }
}

async function fetchFileChangesAllBranches(owner, repo, local) {
  if (local) {
    try {
      const repoPath = `/app/clones/${repo}`;
      const fileChangeCounts = {};
      const seenCommits = new Set();

      // Récupérer toutes les branches (locales et distantes)
      const { stdout: branchesStdout } = await execPromise(`git -C ${repoPath} branch -a --format="%(refname:short)"`);
      const branches = branchesStdout
        .split('\n')
        .map(b => b.trim())
        .filter(b => b.length > 0);

      for (const branch of branches) {
        // Récupérer tous les commits de la branche (sha + auteur)
        const { stdout: commitsStdout } = await execPromise(`git -C ${repoPath} log ${branch} --pretty=format:"%H|%ae"`);
        const commitLines = commitsStdout.split('\n').filter(s => s.length > 0);

        for (const line of commitLines) {
          const [sha, authorEmail] = line.split('|');
          if (seenCommits.has(sha)) continue; // déjà traité
          seenCommits.add(sha);

          // Récupérer fichiers modifiés pour ce commit
          const { stdout: filesStdout } = await execPromise(`git -C ${repoPath} show --pretty=format: --name-only ${sha}`);
          const files = filesStdout.split('\n').filter(f => f.length > 0);

          for (const file of files) {
            if (!fileChangeCounts[file]) {
              fileChangeCounts[file] = { totalChanges: 0, contributors: {} };
            }
            fileChangeCounts[file].totalChanges++;
            fileChangeCounts[file].contributors[authorEmail] = (fileChangeCounts[file].contributors[authorEmail] || 0) + 1;
          }
        }
      }

      return fileChangeCounts;
    } catch (error) {
      console.error('Error fetching file changes locally:', error);
      return {};
    }
  } else {
    // Version API GitHub
    try {
      const fileChangeCounts = {};
      const seenCommits = new Set();

      const branchesResponse = await octokit.repos.listBranches({
        owner,
        repo,
        per_page: 100,
      });
      const branches = branchesResponse.data;

      for (const branch of branches) {
        let page = 1;
        const perPage = 100;

        while (true) {
          const commitsResponse = await octokit.repos.listCommits({
            owner,
            repo,
            sha: branch.name,
            per_page: perPage,
            page,
          });

          const commits = commitsResponse.data;
          if (commits.length === 0) break;

          for (const commit of commits) {
            const sha = commit.sha;
            if (seenCommits.has(sha)) continue; // dédoublonnage
            seenCommits.add(sha);

            const commitDetails = await octokit.repos.getCommit({
              owner,
              repo,
              ref: sha,
            });

            const authorEmail = commitDetails.data.commit.author.email || "unknown";

            for (const file of commitDetails.data.files || []) {
              if (!fileChangeCounts[file.filename]) {
                fileChangeCounts[file.filename] = { totalChanges: 0, contributors: {} };
              }
              fileChangeCounts[file.filename].totalChanges++;
              fileChangeCounts[file.filename].contributors[authorEmail] = (fileChangeCounts[file.filename].contributors[authorEmail] || 0) + 1;
            }
          }

          if (commits.length < perPage) break;
          page++;
        }
      }

      return fileChangeCounts;
    } catch (error) {
      console.error('Error fetching file changes for all branches:', error);
      return {};
    }
  }
}

/**
 * Récupère le nombre de lignes de code attribuées à chaque contributeur
 * chaque jour entre sinceDate et untilDate, en inspectant toutes les branches.
 */
async function fetchBlameAllBranches(owner, repo, local) {
  if (local) {
    //console.warn('fetchBlameAllBranches ne supporte que le mode local pour l’instant.');
    return {};
  }

  try {
    const repoPath = `/app/clones/${repo}`;
    const resultsByDate = {};

    const start = parseISO(sinceDate);
    const end = parseISO(untilDate);

    const { stdout: branchesStdout } = await execPromise(
      `git -C ${repoPath} branch -a --format="%(refname:short)"`
    );
    const branches = branchesStdout
      .split('\n')
      .map(b => b.trim())
      .filter(b => b.length > 0 && !b.startsWith('('));

    console.log('Branches détectées :', branches);

    for (let d = start; !isAfter(d, end); d = addDays(d, 1)) {
      const dateStr = format(d, 'yyyy-MM-dd');
      const blamePerAuthor = {};
      const seenCommits = new Set();

      //console.log(`📅 Date : ${dateStr}`);

      for (const branch of branches) {
        try {
          const { stdout: shaOut } = await execPromise(
            `git -C ${repoPath} rev-list -1 --before="${dateStr} 23:59:59" ${branch}`
          );
          const commitSha = shaOut.trim();
          if (!commitSha || seenCommits.has(commitSha)) {
            continue;
          }

          seenCommits.add(commitSha);
          //console.log(`🔍 Branch: ${branch}, Commit: ${commitSha}`);

          await execPromise(`git -C ${repoPath} checkout -f ${commitSha}`);

          const { stdout: fileList } = await execPromise(`git -C ${repoPath} ls-files`);
          const files = fileList.split('\n').filter(f => f.trim().length > 0);

          for (const file of files) {
              if (/\.(svg|png|jpg|jpeg|gif|ico|pdf|exe|bin|sql)$/i.test(file)) {
                continue; // passe au fichier suivant
              }
              try {
              const { stdout: blameOutput } = await execPromise(
                `git -C ${repoPath} blame --line-porcelain ${file}`
              );
              const lines = blameOutput.split('\n');
              for (const line of lines) {
                if (line.startsWith('author ')) {
                  const author = line.slice(7).trim();
                  blamePerAuthor[author] = (blamePerAuthor[author] || 0) + 1;
                }
              }
            } catch (e) {
              // Fichier binaire ou erreur d'encodage
              console.warn(`⚠️ Erreur de blame sur le fichier ${file}:`, e.message);
              continue;
            }
          }
        } catch (err) {
          console.warn(`⛔ Erreur sur branche ${branch} à la date ${dateStr}:`, err.message);
          continue;
        }
      }

      //console.log(`✅ Résultats ${dateStr}:`, blamePerAuthor);
      resultsByDate[dateStr] = blamePerAuthor;
    }

    return resultsByDate;
  } catch (err) {
    //console.error('💥 Erreur globale dans fetchBlameAllBranches:', err);
    return {};
  }
}



// Fetch issues
async function fetchIssues(owner, repo, local) {
  if (local) {
    console.warn('fetchIssues: No local issue store implemented, returning empty array.');
    return [];
  } else {
    let page = 1;
    const perPage = 100;
    const issues = [];

    try {
      while (true) {
        const response = await octokit.issues.listForRepo({
          owner,
          repo,
          state: 'all',
          per_page: perPage,
          page,
        });

        if (response.data.length === 0) {
          break;
        }

        issues.push(...response.data);

        if (response.data.length < perPage) {
          break;
        }
        page++;
      }

      // Process issues to include only necessary fields
      const processedIssues = issues.map((issue) => ({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at,
        url: issue.html_url,
      }));

      return processedIssues;
    } catch (error) {
      console.error('Error fetching issues:', error);
      return [];
    }
  }
}


// Fetch dependencies
async function fetchDependencies(owner, repo, local) {
  if (local) {
    try {
      const localPath = path.resolve('/app/clones', repo, 'package.json');
      const content = await fs.readFile(localPath, 'utf-8');
      const packageJson = JSON.parse(content);

      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      return dependencies || {};
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn(`package.json not found locally in /app/clones/${repo}. Dependencies will be empty.`);
        return {};
      }
      console.error('Error reading local package.json:', error);
      return {};
    }
  } else {
    try {
      const response = await octokit.repos.getContent({
        owner,
        repo,
        path: 'package.json',
      });

      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      const packageJson = JSON.parse(content);

      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      return dependencies || {};
    } catch (error) {
      if (error.status === 404) {
        console.warn(`package.json not found in repository: ${owner}/${repo}. Dependencies will be empty.`);
        return {};
      }
      console.error('Error fetching dependencies:', error);
      return {};
    }
  }
}

// Fetch commits from the repository
async function fetchCommits(owner, repo, local) {
  if (local) {
    try {
      const repoPath = `/app/clones/${repo}`;

      const { stdout: branchesStdout } = await execPromise(`git -C ${repoPath} branch -a --format="%(refname:short)"`);
      const branches = branchesStdout
        .split('\n')
        .map(b => b.trim())
        .filter(b => b.length > 0);

      const commits = [];
      const seenCommits = new Set();

      for (const branch of branches) {
        const { stdout: commitsStdout } = await execPromise(
          `git -C ${repoPath} log ${branch} --pretty=format:"%H|%an|%ae|%ad|%s"`
        );

        const lines = commitsStdout.split('\n').filter(line => line.length > 0);

        for (const line of lines) {
          const [sha, authorName, authorEmail, authorDate, message] = line.split('|');

          if (seenCommits.has(sha)) continue;
          seenCommits.add(sha);

          // Récupérer les parents du commit
          const { stdout: parentsStdout } = await execPromise(
            `git -C ${repoPath} log -1 --pretty=%P ${sha}`
          );
          const parents = parentsStdout.trim().split(' ').filter(p => p.length > 0);

          const { stdout: statsStdout } = await execPromise(
            `git -C ${repoPath} show --shortstat --oneline ${sha}`
          );

          let additions = 0;
          let deletions = 0;

          const statsLine = statsStdout.split('\n').find(line => line.includes('files changed'));
          if (statsLine) {
            const matchAdd = statsLine.match(/(\d+) insertions?/);
            const matchDel = statsLine.match(/(\d+) deletions?/);
            if (matchAdd) additions = parseInt(matchAdd[1], 10);
            if (matchDel) deletions = parseInt(matchDel[1], 10);
          }
          //console.log(`Processing commit ${sha} : +${additions} additions, -${deletions} deletions`);


          commits.push({
            sha,
            commit: {
              message,
              author: {
                name: authorName,
                email: authorEmail,
                date: authorDate,
              },
            },
            parents,
            stats: {
              additions,
              deletions,
            }
          });
          
        }
      }

      return commits;
    } catch (error) {
      console.error('Error fetching commits locally:', error);
      return [];
    }
  } else {
    try {
      let page = 1;
      const perPage = 100;
      const commits = [];

      while (true) {
        const response = await octokit.repos.listCommits({
          owner,
          repo,
          per_page: perPage,
          page,
        });

        if (response.data.length === 0) {
          break;
        }

        commits.push(...response.data);

        if (response.data.length < perPage) {
          break;
        }
        page++;
      }

      return commits;
    } catch (error) {
      console.error('Error fetching commits:', error);
      return [];
    }
  }
}



// Function to generate embeddings using OpenAI API
async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error.response?.data || error.message);
    return null;
  }
}

// Update generateEmbeddingWithOllama function
async function generateEmbeddingWithOllama(text) {
  try {
    console.log('Sending request to Ollama API...');

    const response = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'nomic-embed-text',
        prompt: text,
        options: { temperature: 0 }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Raw response from Ollama API:', JSON.stringify(data, null, 2));

    // Extract embedding from response
    let embedding;
    if (data.embeddings && Array.isArray(data.embeddings)) {
      embedding = data.embeddings;
    } else if (data.embedding && Array.isArray(data.embedding)) {
      embedding = data.embedding;
    } else {
      throw new Error('Invalid embedding format in response');
    }

    if (!embedding.length) {
      throw new Error('Empty embedding array received');
    }

    console.log(`Successfully generated embedding with ${embedding.length} dimensions`);
    return embedding;

  } catch (error) {
    console.error('Error in generateEmbeddingWithOllama:', error.message);
    throw error;
  }
}

// Update the existing generateEmbeddingWithRetry function
async function generateEmbeddingWithRetry(text, retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const embedding = await generateEmbeddingWithOllama(text);
      if (embedding) return embedding;
    } catch (error) {
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  return null;
}

// Function to generate completions using OpenAI API
async function generateCompletion(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
      ]
    });
    const completion = response.choices[0].message.content.trim();
    return completion;
  } catch (error) {
    console.error('Error generating completion:', error.response?.data || error.message);
    return 'Sorry, I could not generate a response.';
  }
}

// Update insertCommitEmbeddings function
async function insertCommitEmbeddings(analysisId, commits) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO commit_embeddings (commit_hash, commit_message, embedding, code_analysis_id)
      VALUES ($1, $2, $3::vector, $4)
      ON CONFLICT (code_analysis_id, commit_hash) DO NOTHING;
    `;

    for (const commit of commits) {
      const embedding = await generateEmbeddingWithRetry(commit.commit.message);
      if (embedding) {
        const formattedEmbedding = `[${embedding.join(',')}]`;
        await client.query(insertQuery, [
          commit.sha,
          commit.commit.message,
          formattedEmbedding,
          analysisId
        ]);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error inserting commit embeddings:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Middleware to attach repo information based on sessionId
async function attachRepoInfo(req, res, next) {
  //const sessionId = req.sessionID;
  const sessionId = 1;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing session ID.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT repo_url FROM code_analysis WHERE session_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
      [sessionId, 'complete']
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No analysis found for the provided session ID.' });
    }

    const repoUrl = rows[0].repo_url;
    const { owner, repo } = extractRepoInfo(repoUrl);

    // Attach to request object
    req.owner = owner;
    req.repo = repo;

    next();
  } catch (error) {
    console.error('Error attaching repo info:', error);
    res.status(500).json({ error: 'Failed to retrieve repository information.' });
  }
}

// Add this middleware for session validation
const validateSession = async (req, res, next) => {
  //const sessionId = req.sessionID || req.cookies['connect.sid'];
  const sessionId = 1;
  if (!sessionId) {
    return res.status(401).json({ error: 'No session ID provided' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id FROM code_analysis WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
      [sessionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No analysis found for session' });
    }

    req.analysisId = rows[0].id;
    next();
  } catch (error) {
    console.error('Session validation error:', error);
    res.status(500).json({ error: 'Session validation failed' });
  }
};

// Main analysis endpoint
app.get('/api/analysis-data', async (req, res) => {
  const { analysisId } = req.query;
  console.log(`Received /api/analysis-data request for analysisId: ${analysisId}`);
  try {
    const { rows } = await pool.query(
      'SELECT * FROM code_analysis WHERE id = $1',
      [analysisId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Analysis not found'
      });
    }

    // Format data consistently
    const analysis = rows[0];
    
    // Get all commit data
    const commitData = analysis.commits?.commits || [];

    res.json({
      status: 'success',
      data: {
        id: analysis.id,
        repo_url: analysis.repo_url,
        status: analysis.status,
        created_at: analysis.created_at,
        codeEvolution: commitData, // Return full commit objects
        file_changes: analysis.file_changes || {},
        commit_activity: analysis.commit_activity || [],
        blame_by_day: analysis.blame_by_day || {},
        contributors: analysis.contributors || [],
        dependencies: analysis.dependencies || {},
        issues: analysis.issues || []
      }
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      status: 'error', 
      message: error.message
    });
  }
});

app.post('/api/process-commits', async (req, res) => {
  const { analysisId, commitCount, local } = req.body;

  try {
    // Get repository info
    const { rows } = await pool.query(
      'SELECT repo_url FROM code_analysis WHERE id = $1',
      [analysisId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Analysis not found'
      });
    }

    const { owner, repo } = extractRepoInfo(rows[0].repo_url);
    
    // Fetch commits
    const commits = await fetchCommits(owner, repo, local);
    
    // Store full commit data in code_analysis
    const processedCommits = commits.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        name: commit.commit.author.name,
        email: commit.commit.author.email,
        date: commit.commit.author.date
      },
      parents: commit.parents,
      stats: {
        additions: commit.stats.additions || 0,
        deletions: commit.stats.deletions || 0
      }
    }));

    // Update code_analysis with full commit data
    await pool.query(
      `UPDATE code_analysis 
       SET commits = $1,
           status = 'completed'
       WHERE id = $2`,
      [JSON.stringify({
        totalCommits: commitCount,
        commits: processedCommits
      }), analysisId]
    );

    // Process embeddings in parallel
    /*await Promise.all(commits.map(async (commit) => {
      try {
        const embedding = await generateEmbeddingWithRetry(commit.commit.message);
        if (embedding) {
          await pool.query(
            `INSERT INTO commit_embeddings 
             (code_analysis_id, commit_hash, commit_message, embedding)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (code_analysis_id, commit_hash) 
             DO UPDATE SET embedding = EXCLUDED.embedding`,
            [analysisId, commit.sha, commit.commit.message, `[${embedding.join(',')}]`]
          );
        }
      } catch (error) {
        console.error(`Error processing embedding for commit ${commit.sha}:`, error);
      }
    }));*/

    res.json({
      status: 'success',
      message: 'Commits processed successfully',
      processedCommits: processedCommits.length
    });

  } catch (error) {
    console.error('Error processing commits:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Main analysis endpoint
app.post('/api/analyze', async (req, res) => {
  const { repoUrl, local} = req.body;
  const sessionId = 1; // À adapter si multi-session

  console.log(`Received /api/analyze request with repoUrl: ${repoUrl}, sessionId: ${sessionId}`);

  if (!repoUrl) {
    return res.status(400).json({ error: 'repoUrl is required.' });
  }

  try {
    const { owner, repo } = extractRepoInfo(repoUrl);

    const totalCommits = await getTotalCommitCountAllBranches(owner, repo, local);
    const contributors = await fetchContributors(owner, repo, local);
    const commitActivity = await fetchCommitActivityAllBranches(owner, repo, local);
    const fileChanges = await fetchFileChangesAllBranches(owner, repo, local);
    const issues = await fetchIssues(owner, repo, local);
    const dependencies = await fetchDependencies(owner, repo, local);

    console.log(`Running fetchBlameAllBranches from ${sinceDate} to ${untilDate}`);
    const blameByDay = await fetchBlameAllBranches(owner, repo, local);
    console.log('BlameByDay to store:', JSON.stringify(blameByDay).slice(0, 100), '...'); // juste un aperçu


    const analysis = await pool.query(
      `
      INSERT INTO code_analysis
        (session_id, repo_url, status, commits, contributors, commit_activity, file_changes, dependencies, issues, blame_by_day)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (session_id, repo_url)
      DO UPDATE SET
        status = 'completed',
        commits = $4,
        contributors = $5,
        commit_activity = $6,
        file_changes = $7,
        dependencies = $8,
        issues = $9,
        blame_by_day = $10
      RETURNING id
      `,
      [
        sessionId,
        repoUrl,
        'completed',
        JSON.stringify({ totalCommits }),
        JSON.stringify(contributors),
        JSON.stringify(commitActivity),
        JSON.stringify(fileChanges),
        JSON.stringify(dependencies),
        JSON.stringify(issues),
        JSON.stringify(blameByDay),
      ]
    );

    const analysisId = analysis.rows[0].id;
    req.session.analysisId = analysisId;

    const { rows } = await pool.query(
      'SELECT blame_by_day FROM code_analysis WHERE id = $1',
      [analysisId]
    );
    console.log('BlameByDay stored:', JSON.stringify(rows[0].blame_by_day).slice(0, 100), '...'); // juste un aperçu

    req.session.save(err => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ status: 'error', message: 'Failed to save session.' });
      }

      res.json({
        status: 'success',
        message: 'Analysis completed successfully',
        analysisId,
        totalCommits,
        blameByDay
      });
    });
  } catch (error) {
    console.error('Error initializing analysis:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to initialize analysis.',
    });
  }
});


// Endpoint to retrieve analysis by ID
app.get('/api/analysis/:analysisId', async (req, res) => {
  const { analysisId } = req.params;

  try {
    const { rows } = await pool.query('SELECT * FROM code_analysis WHERE id = $1', [analysisId]);

    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Analysis not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error retrieving analysis:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Test session endpoint
app.get('/api/session', async (req, res) => {
  //const sessionId = req.sessionID || req.cookies['connect.sid'];
  const sessionId = 1;
  const analysisId = req.session.analysisId || req.headers['x-analysis-id'];

  try {
    if (analysisId) {
      // Verify analysis exists
      const { rows } = await pool.query(
        'SELECT id FROM code_analysis WHERE id = $1',
        [analysisId]
      );
      
      if (rows.length > 0) {
        return res.json({
          sessionId,
          analysisId: rows[0].id
        });
      }
    }

    res.json({ 
      sessionId,
      analysisId: null 
    });
  } catch (error) {
    console.error('Session error:', error);
    res.status(500).json({ error: 'Session error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// File Change Frequency Endpoint
app.get('/api/file-change-frequency', validateSession, async (req, res) => {
  try {
    const analysisId = req.query.analysisId;

    console.log(`Fetching file change frequency for analysisId: ${analysisId}`);
    const { rows } = await pool.query(
      'SELECT file_changes FROM code_analysis WHERE id = $1',
      [req.query.analysisId]
    );

    if (!rows[0] || !rows[0].file_changes) {
      return res.status(404).json({ error: 'No file change data found' });
    }

    const fileChanges = rows[0].file_changes;
    res.json({ status: 'success', analysisId: analysisId, data: fileChanges });
  } catch (error) {
    console.error('Error fetching file changes:', error);
    res.status(500).json({ error: 'Failed to fetch file changes' });
  }
});

// Commit Activity Timeline Endpoint
app.get('/api/commit-activity-timeline', validateSession, async (req, res) => {
  try {
    const analysisId = req.query.analysisId;

    console.log(`Fetching commit activity for analysisId: ${analysisId}`);
    const { rows } = await pool.query(
      'SELECT commit_activity FROM code_analysis WHERE id = $1',
      [req.query.analysisId]
    );
    if (!rows[0]?.commit_activity) {
      return res.status(404).json({ error: 'No commit activity data found' });
    }
    res.json({
      status: 'success',
      analysisId: analysisId,
      data: rows[0].commit_activity
    });
  } catch (error) {
    console.error('Error fetching commit activity:', error);
    res.status(500).json({ error: 'Failed to fetch commit activity' });
  }
});

// Contributor Statistics
app.get('/api/contributor-statistics', validateSession, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT contributors FROM code_analysis WHERE id = $1',
      [req.query.analysisId]
    );
    if (!rows[0]?.contributors) {
      return res.status(404).json({ error: 'No contributor data found' });
    }
    res.json({ status: 'success', data: rows[0].contributors });
  } catch (error) {
    console.error('Error fetching contributors:', error);
    res.status(500).json({ error: 'Failed to fetch contributors' });
  }
});

// Lines of code quantity by author across a timespan
app.get('/api/blame-evolution', validateSession, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT blame_by_day FROM code_analysis WHERE id = $1',
      [req.query.analysisId]
    );
    if (!rows[0]?.blame_by_day) {
      return res.status(404).json({ error: 'No blame data found' });
    }
    console.log('BlameByDay retrieved :', JSON.stringify(rows[0].blame_by_day).slice(0, 200), '...'); // juste un aperçu
    res.json({ status: 'success', data: rows[0].blame_by_day });
  } catch (error) {
    console.error('Error fetching blames :', error);
    res.status(500).json({ error: 'Failed to fetch blames' });
  }
});

app.get('/api/global-stats', validateSession, async (req, res) => {
  try {
    let analysisId = req.query.analysisId;

    if (!analysisId) {
      return res.status(400).json({ error: 'Aucun analysisId fourni.' });
    }

    analysisId = parseInt(analysisId, 10);
    if (isNaN(analysisId)) {
      return res.status(400).json({ error: 'analysisId invalide.' });
    }

    // Requête SQL : récupérer les données commits pour ce analysisId
    const { rows } = await pool.query(
      'SELECT commits FROM code_analysis WHERE id = $1',
      [analysisId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Aucune donnée trouvée pour cet analysisId.' });
    }

    //console.log("Contenu de rows[0].commits AVANT parsing:", rows[0].commits);
    // Parsing défensif au cas où commits serait une chaîne JSON
    let parsed = typeof rows[0].commits === 'string' ? JSON.parse(rows[0].commits) : rows[0].commits;

    //console.log("Contenu de 'parsed' APRES parsing:", parsed);

    const commitList = parsed?.commits || [];

    console.log("CommitList:", JSON.stringify(commitList, null, 2));

    const extractPseudoFromEmail = (email) => {
      if (!email) return 'unknown';
      if (email.includes('+')) {
        // Prend la partie après le '+' et avant le '@'
        return email.split('+')[1].split('@')[0];
      }
      // Prend la partie avant le '@'
      return email.split('@')[0];
    };

    const stats = {};

    for (const commit of commitList) {
      const authorEmail = commit.author?.email;
      
      // Utilisation de la fonction de nettoyage ici
      const authorPseudo = extractPseudoFromEmail(authorEmail);
      
      if (!authorPseudo || authorPseudo === 'unknown') {
        // Si le pseudo est inconnu après extraction, on ignore le commit
        continue; 
      }

      if (!stats[authorPseudo]) { // Utilise le pseudo comme clé
        stats[authorPseudo] = {
          totalCommits: 0,
          additions: 0,
          deletions: 0,
        };
      }

      stats[authorPseudo].totalCommits += 1;
      stats[authorPseudo].additions += commit.stats?.additions || 0;
      stats[authorPseudo].deletions += commit.stats?.deletions || 0;
    }

    res.json({ stats });
  } catch (error) {
    console.error('Erreur lors de la génération des stats globales :', error);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des statistiques globales.' });
  }
});




// Codebase Heatmap
app.get('/api/code-evolution', validateSession, async (req, res) => {
  try {
    const analysisId = req.query.analysisId;

    console.log(`Generating code evolution for analysisId: ${analysisId}`);
    const { rows } = await pool.query(
      'SELECT commits FROM code_analysis WHERE id = $1',
      [req.query.analysisId]
    );
    if (!rows[0]?.commits) {
      return res.status(404).json({ error: 'No code evolution data found' });
    }
    res.json({ status: 'success', analysisId: analysisId, data: rows[0].commits.commits });
  } catch (error) {
    console.error('Error generating code evolution:', error);
    res.status(500).json({ error: 'Failed to generate code evolution' });
  }
});


// Codebase Heatmap
app.get('/api/codebase-heatmap', validateSession, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT file_changes FROM code_analysis WHERE id = $1',
      [req.query.analysisId]
    );
    if (!rows[0]?.file_changes) {
      return res.status(404).json({ error: 'No file change data found' });
    }
    res.json({ status: 'success', data: rows[0].file_changes });
  } catch (error) {
    console.error('Error generating heatmap:', error);
    res.status(500).json({ error: 'Failed to generate heatmap' });
  }
});

// Dependency Graph
app.get('/api/dependency-graph', validateSession, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT dependencies FROM code_analysis WHERE id = $1',
      [req.analysisId]
    );
    if (!rows[0]?.dependencies) {
      return res.status(404).json({ error: 'No dependency data found' });
    }
    res.json({ status: 'success', analysisId, data: rows[0].dependencies });
  } catch (error) {
    console.error('Error fetching dependencies:', error);
    res.status(500).json({ error: 'Failed to fetch dependencies' });
  }
});

// Linked Issues
app.get('/api/linked-issues', validateSession, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT issues FROM code_analysis WHERE id = $1',
      [req.analysisId]
    );
    if (!rows[0]?.issues) {
      return res.status(404).json({ error: 'No issues data found' });
    }
    res.json({ status: 'success', data: rows[0].issues });
  } catch (error) {
    console.error('Error fetching issues:', error);
    res.status(500).json({ error: 'Failed to fetch issues' });
  }
});

// Semantic Search in Commits
app.get('/api/search-commits', validateSession, async (req, res) => {
  const { query } = req.query;
  if (!query?.trim()) {
    return res.status(400).json({
      status: 'error',
      message: 'Search query is required'
    });
  }

  try {
    // Generate embedding for search query
    const queryEmbedding = await generateEmbeddingWithRetry(query);
    if (!queryEmbedding) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to generate embedding for query'
      });
    }

    console.log('Generated embedding dimensions:', queryEmbedding.length);

    // Modified query with explicit casting and better similarity threshold
    const searchResults = await pool.query(
      `SELECT
        commit_hash,
        commit_message,
        1 - (embedding <=> $1::vector) as similarity
       FROM commit_embeddings
       WHERE code_analysis_id = $2
       AND 1 - (embedding <=> $1::vector) > 0.5
       ORDER BY similarity DESC
       LIMIT 5`,
      [
        `[${queryEmbedding.join(',')}]`,
        req.analysisId
      ]
    );

    console.log(`Found ${searchResults.rows.length} results`);

    if (searchResults.rows.length === 0) {
      return res.json({
        status: 'success',
        message: 'No matching commits found',
        results: []
      });
    }

    res.json({
      status: 'success',
      results: searchResults.rows.map(row => ({
        commit_hash: row.commit_hash,
        commit_message: row.commit_message,
        similarity: parseFloat(row.similarity.toFixed(4))
      }))
    });

  } catch (error) {
    console.error('Search error:', error);
    console.error('Error details:', {
      query,
      analysisId: req.analysisId,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to perform semantic search',
      details: error.message
    });
  }
});

// Question Answering
app.post('/api/question-answering', validateSession, async (req, res) => {
  const { question } = req.body;
  if (!question?.trim()) {
    return res.status(400).json({
      status: 'error',
      message: 'Valid question is required'
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT commit_message
       FROM commit_embeddings
       WHERE code_analysis_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.analysisId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No commit data available'
      });
    }

    const prompt = `
      You are an assistant analyzing commit messages.

      Commit History:
      ${rows.map(r => r.commit_message).join('\n')}

      Question: ${question}

      Answer:`;

    const answer = await generateCompletion(prompt);
    res.json({ status: 'success', answer });

  } catch (error) {
    console.error('Question answering error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to process question'
    });
  }
});

// Summarization
app.post('/api/summarize', validateSession, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT commit_message
       FROM commit_embeddings
       WHERE code_analysis_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [req.analysisId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No commit messages to summarize'
      });
    }

    const prompt = `
      Provide a concise summary of these commit messages:
      ${rows.map(r => r.commit_message).join('\n')}

      Summary:`;

    const summary = await generateCompletion(prompt);
    res.json({ status: 'success', summary });

  } catch (error) {
    console.error('Summarization error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate summary'
    });
  }
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

