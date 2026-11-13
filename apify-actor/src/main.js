import { Actor } from 'apify';
import { chromium } from 'playwright';

await Actor.init();

let browser;

try {
    const input = await Actor.getInput();

    let cookies = input?.cookies ?? [];

    if (typeof cookies === 'string') {
        cookies = JSON.parse(cookies);
    }

    if (!Array.isArray(cookies) || cookies.length === 0) {
        throw new Error('Cookies are missing or invalid');
    }

    browser = await chromium.launch({
        headless: true,
    });

    const context = await browser.newContext();

    const playwrightCookies = cookies
        .filter(cookie => cookie.domain?.includes('dou.ua'))
        .map(cookie => {
            const result = {
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path || '/',
                secure: Boolean(cookie.secure),
                httpOnly: Boolean(cookie.httpOnly),
            };

            const expires = cookie.expires ?? cookie.expirationDate;

            if (expires && Number(expires) > 0) {
                result.expires = Number(expires);
            }

            const sameSiteMap = {
                strict: 'Strict',
                lax: 'Lax',
                no_restriction: 'None',
            };

            const sameSite = sameSiteMap[
                String(cookie.sameSite).toLowerCase()
            ];

            if (sameSite) {
                result.sameSite = sameSite;
            }

            return result;
        });

    if (playwrightCookies.length === 0) {
        throw new Error('No DOU cookies found');
    }

    await context.addCookies(playwrightCookies);

    console.log('Cookies added:', playwrightCookies.length);

    const page = await context.newPage();

    console.log('Opening DOU Inbox...');

    await page.goto('https://dou.ua/inbox/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });

    await page.waitForTimeout(3000);

    const title = await page.title();
    const url = page.url();

    const pageText = await page.locator('body').innerText();

    const links = await page.locator('a[href]').evaluateAll(anchors =>
        anchors.map(anchor => ({
            text: anchor.innerText.trim(),
            href: anchor.href,
        })).filter(link =>
            link.text && link.href.includes('dou.ua')
        )
    );

    const loginRequired =
        /увійти|войти|log in|login/i.test(pageText) &&
        !/вийти|выйти|log out|logout/i.test(pageText);

    const result = {
        source: 'DOU Inbox',
        url,
        title,
        loginRequired,
        pageText: pageText.slice(0, 12000),
        links: links.slice(0, 100),
        cookiesAdded: playwrightCookies.length,
        checkedAt: new Date().toISOString(),
    };

    console.log('URL:', url);
    console.log('TITLE:', title);
    console.log('PAGE LENGTH:', pageText.length);

    await Actor.pushData(result);

    console.log('Data saved to Apify Dataset');

    const webhookUrl =
        'https://penniless-tapioca-modulator.ngrok-free.dev/webhook/dou-inbox';

    console.log('Sending data to n8n...');

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(result),
        signal: AbortSignal.timeout(30000),
    });

    const responseText = await response.text();

    console.log('N8N STATUS:', response.status);
    console.log('N8N RESPONSE:', responseText);

    if (!response.ok) {
        throw new Error(`n8n Webhook error: ${response.status}`);
    }

    console.log('Successfully sent data to n8n!');

} catch (error) {
    console.error('ACTOR ERROR:', error.message);
    throw error;

} finally {
    if (browser) {
        await browser.close();
    }

    await Actor.exit();
}