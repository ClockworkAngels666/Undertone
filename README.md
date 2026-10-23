# 🌐 Diplomatic Language Analyzer

A free web tool that measures **hostility**, **cooperation** and **rhetorical shifts** in diplomatic texts: speeches, joint statements and state-media articles.

---

## Features

| Tab | What the user does | What they get |
|---|---|---|
| 🔍 **Analyze a text** | Paste a text or upload a `.txt` / `.pdf` file | 5 tone metrics, a comparison with UN speeches, the text with key words highlighted, a score for every sentence |
| 📈 **Compare over time** | Upload a CSV (`country`, `year`, `text`) | Trend charts per country and year, tracking of chosen keywords |
| 🌐 **UN General Debate data** | Pick countries, years and a metric | Charts from 1946 to today, the biggest "turning points", notable sentences for close reading, a country ranking |

Users can also **edit the dictionaries** in the sidebar to fit their own research question.

## Project structure

```
app.py                  Web interface (Streamlit) – what users see
analysis.py             The "brain": cleaning, sentence splitting, VADER, dictionaries, metrics
build_un_data.py        Run ONCE to pre-score the whole UN dataset
requirements.txt        Libraries the server installs automatically
un_scores.csv.gz        (created in Step 2) scores for every country–year
un_sentences.csv.gz     (created in Step 2) the most notable sentences of each speech
notebook/               Step-by-step Google Colab notebook + sample CSV
tests/                  Automated tests for analysis.py
```

**Why split it this way?** The interface and the calculations are kept apart, so changing one cannot break the other. Scoring 10,000+ speeches takes 15–25 minutes, so it is done once in advance, and everyone who opens the tool sees results instantly.

---

## 🚀 Putting the tool online (free, about 45 minutes)

You need a Google account (for Colab) and a free GitHub account.

### Step 1: Put the code on GitHub

1. Go to **github.com** and sign up.
2. Click **+** (top right) → **New repository**.
   - *Repository name*: `diplomatic-language-analyzer`
   - Choose **Public**, then click **Create repository**.
3. On the new page, click **uploading an existing file**.
4. Drag in every file and folder from this project **except** `notebook/`, then click **Commit changes**.

### Step 2: Build the UN data (run once on Google Colab)

1. Go to **colab.research.google.com** → **New notebook**.
2. Click the 📁 icon on the left, then the upload button. Upload `analysis.py` and `build_un_data.py`.
3. Paste this into the first code cell and press **Shift + Enter**:
   ```
   !pip install -q vaderSentiment
   !python build_un_data.py
   ```
   The script downloads the UNGDC dataset from Harvard Dataverse and scores every speech, printing its progress and the minutes left.
4. **If the automatic download fails**, do it by hand:
   - Open https://doi.org/10.7910/DVN/0TJX8Y and download the archive with the speeches (ending in `.tgz` or `.zip`).
   - Upload it to Colab as in point 2.
   - Run: `!python build_un_data.py --file NAME_OF_THE_FILE.tgz`
5. When you see **✅ Done!**, find `un_scores.csv.gz` and `un_sentences.csv.gz` in the left panel. Click ⋮ next to each → **Download**.
6. Back in your GitHub repository: **Add file → Upload files**, drag both files in, **Commit changes**.

### Step 3: Deploy on Streamlit Community Cloud

1. Go to **share.streamlit.io** and sign in with GitHub.
2. Click **Create app** → **Yup, I have an app**.
3. Fill in:
   - **Repository**: `your-name/diplomatic-language-analyzer`
   - **Branch**: `main`
   - **Main file path**: `app.py`
   - **App URL**: a short name, e.g. `diplomatic-language`. The link becomes `https://diplomatic-language.streamlit.app`
4. Click **Deploy** and wait 2–5 minutes while the server installs the libraries. You now have a **public link** anyone can open.

### Step 4: Put your name on the tool

On GitHub, open `app.py`, click ✏️ and edit the two lines near the top:

```python
AUTHOR = "Your Name"
GITHUB_URL = "https://github.com/your-name/diplomatic-language-analyzer"
```

Click **Commit changes**. The live tool updates itself about a minute later.

> 💤 Free apps "sleep" after 12 hours without visitors. The next visitor just clicks the wake-up button and waits about half a minute.

---

## Working on it later

- **Change the default dictionaries**: edit `HOSTILE_TERMS` and `COOPERATIVE_TERMS` in `analysis.py`. Then repeat Step 2 so the UN data uses the same dictionaries.
- **Add keywords to the UN data**: edit `DEFAULT_KEYWORDS` in `analysis.py`, then repeat Step 2.
- **Run it on your own computer (Windows)**: install Python from python.org (tick *Add python.exe to PATH*). Open the project folder, type `cmd` in the address bar and press Enter, then run:
  ```
  py -m pip install -r requirements.txt
  py -m unittest discover tests
  py -m streamlit run app.py
  ```
  Your browser opens the tool at http://localhost:8501.

## Method and limitations

- **Diplomatic dictionaries**: hostile and cooperative words counted per 1,000 words.
- **Tone balance** = (cooperative − hostile) / (cooperative + hostile), from −1 (confrontational) to +1 (conciliatory).
- **VADER**: sentiment score for each sentence, averaged.
- **Limitations**:
  - Word counting ignores context. *"We do not seek confrontation"* still counts one hostile word.
  - VADER was built for social media.
  - Texts must be in English; UN texts are official English translations.
  - Tone is not policy. Always read the highlighted sentences to validate the numbers.

## Data source

Jankin, S., Baturo, A., & Dasandi, N. (2024). *Words to unite nations: The complete United Nations General Debate Corpus, 1946–present.* Journal of Peace Research. Hosted on Harvard Dataverse: https://doi.org/10.7910/DVN/0TJX8Y
