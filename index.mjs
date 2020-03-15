import express from 'express';
import _ from 'lodash';
import morgan from 'morgan';
import bodyParser from 'body-parser';
import puppeteer from 'puppeteer';

const app = express();
app.use(morgan('dev'));
app.use(bodyParser('json'));

const specialNameMap = {
  'Diễn viên': 'Actresses',
  'Đạo diễn': 'Directors',
  'Thể loại': 'Genres',
  'Quốc gia': 'Nation',
  'Thời lượng': 'Duration',
  'Lượt xem': 'Views',
  'Năm xuất bản': 'Released year',
  'Điểm IMDb': 'IMDb score',
};

const scrapAll = async (url) => {
  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
  const page = await browser.newPage();

  await page.goto(url);

  const nodes = await page.$$('.film-item');
  let movies = [];
  for (const node of nodes) {
    const info = await node.$eval('a', (a) => {
      const url = a.getAttribute('href');
      const title = a.getAttribute('title');
      return { url, title };
    });

    const img = await node.$eval('a > img', (img) => {
      return img.getAttribute('src');
    });

    movies = [...movies, { ...info, img }];
  }
  await browser.close();
  return movies;
};

const isElementVisible = async (page, cssSelector) => {
  let visible = true;
  await page
    .waitForSelector(cssSelector, { visible: true, timeout: 5000 })
    .catch(() => {
      visible = false;
    });
  return visible;
};

const scrapStreamingUrl = async (url) => {
  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
  try {
    const page = await browser.newPage();

    await page.goto(url);
    await page.waitFor(3000);
    const isStreamingUrlAvailable = await isElementVisible(page, '.jw-video');
    console.log(isStreamingUrlAvailable);
    if (isStreamingUrlAvailable) {
      const streaming = await page.$eval('.jw-video', (video) => video.src);
      return await streaming;
    }
  } catch (e) {
    console.log(e.message);
    process.exit();
  } finally {
    await browser.close();
  }
};

const scrapMovieInfo = async (url) => {
  const browser = await puppeteer.launch({ headless: true, args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ]});
  let info = {};

  try {
    const page = await browser.newPage();

    await page.goto(url);

    const description = await page.$eval('.film-content', (div) => div.textContent);
    const filmContentInfo = await page.$$('.film-content p');
    const watchUrl = await page.$eval('.poster a', (a) => a.href);
    info = {...info, watchUrl};

    for (const p of filmContentInfo) {
      const imgTag = await p.$('img');
      if (!imgTag) continue;

      const largeThumbnail = await p.$eval('img', (img) => {
        return img.src
      });
      info = {...info, description, largeThumbnail};
    }

    const listItems = await page.$$('.info-y li');
    for (const item of listItems) {
      const labelTag = await item.$('label');
      if (!labelTag) continue;
      let labelKey = await item.$eval('label', (label) => label.textContent);
      labelKey = labelKey.substring(0, labelKey.length - 1);
      labelKey = specialNameMap[labelKey];
      const spanTag = await item.$('span');
      let labelValues = null;
      if (spanTag) {
        labelValues = await item.$eval('span', (span) => span.textContent);
      } else {
        labelValues = await item.$$eval('a', (aTags) => aTags.map(a => a.textContent));
      }
      info[labelKey] = labelValues;
    }

  } catch (e) {
    console.log(e.message);
    process.exit();
  } finally {
    await browser.close();
  }
  return info;
};

app.post('/all', async (req, res) => {
  const url = req.body.url;

  const data = await scrapAll(url);
  await res.json(data);
});

app.post('/movie_details', async (req, res, next) => {
  const url = req.body.url;
  if (_.isEmpty(url)) {
    res.statusCode = 404;
    return next(new Error('Not found'));
  }
  const info = await scrapMovieInfo(url);
  if (_.isEmpty(info.watchUrl)) await res.json({ info });
  const streamingUrl = await scrapStreamingUrl(info.watchUrl);

  await res.json({ ...info, streamingUrl });
});

app.use((req, res, next) => {
  const error = new Error('Not found');
  error.status = 404;
  next(error);
});

app.use((err, req, res, next) => {
  console.log(err);
  res.status(err.status || 500);
  res.json({
    error: err.message
  })
});

const port = process.env.PORT || 3002;
app.listen(port, () => {
  console.log(`Server is running on ${port}`);
});
