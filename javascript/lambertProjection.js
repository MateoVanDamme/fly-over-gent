// Belgian Lambert-72 ↔ WGS84 conversion
// Uses the full 7-parameter Helmert transform (BD72 ↔ WGS84)
// for sub-meter accuracy.

// --- Ellipsoid constants ---
const HAYFORD = { a: 6378388, f: 1 / 297 };                       // BD72 uses Hayford / Intl 1924
const WGS84   = { a: 6378137, f: 1 / 298.257223563 };

// --- Belgian Lambert-72 projection constants ---
const L72 = {
    n:   0.7716421928,
    aF:  11565915.812935,
    FE:  150000.013,
    FN:  5400088.438,
    lam0: 0.07622522925,  // 4°22'2.952" E central meridian
};

// --- 7-parameter Helmert BD72 → WGS84 ---
// Position Vector convention per EPSG:15929 "BD72 to WGS 84 (3)".
const AS_TO_RAD = Math.PI / (180 * 3600);
const HELMERT = {
    tx: -106.868628,
    ty:   52.297783,
    tz: -103.723893,
    rx:   0.336570 * AS_TO_RAD,
    ry:  -0.456955 * AS_TO_RAD,
    rz:   1.842740 * AS_TO_RAD,
    ds:  -1.2747e-6,
};

// --- Geodetic ↔ Geocentric (ECEF) ---

function geodeticToEcef(latRad, lonRad, h, ell) {
    const { a, f } = ell;
    const e2 = 2 * f - f * f;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    return {
        x: (N + h) * cosLat * Math.cos(lonRad),
        y: (N + h) * cosLat * Math.sin(lonRad),
        z: (N * (1 - e2) + h) * sinLat,
    };
}

function ecefToGeodetic(x, y, z, ell) {
    const { a, f } = ell;
    const e2 = 2 * f - f * f;
    const b = a * (1 - f);
    const ep2 = (a * a - b * b) / (b * b);
    const p = Math.sqrt(x * x + y * y);
    const th = Math.atan2(a * z, b * p);
    const lon = Math.atan2(y, x);
    const sinTh = Math.sin(th), cosTh = Math.cos(th);
    const lat = Math.atan2(z + ep2 * b * sinTh * sinTh * sinTh,
                           p - e2 * a * cosTh * cosTh * cosTh);
    const sinLat = Math.sin(lat);
    const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    const h = p / Math.cos(lat) - N;
    return { lat, lon, h };
}

// --- Helmert (coordinate frame convention) ---

function helmertBD72toWGS84(X, Y, Z) {
    // Position Vector convention: V' = T + (1+ds) * R * V
    const { tx, ty, tz, rx, ry, rz, ds } = HELMERT;
    const s = 1 + ds;
    return {
        x: tx + s * ( X - rz * Y + ry * Z),
        y: ty + s * ( rz * X + Y - rx * Z),
        z: tz + s * (-ry * X + rx * Y + Z),
    };
}

function helmertWGS84toBD72(X, Y, Z) {
    // Inverse
    const { tx, ty, tz, rx, ry, rz, ds } = HELMERT;
    const X2 = X - tx, Y2 = Y - ty, Z2 = Z - tz;
    const s = 1 - ds;
    return {
        x: s * ( X2 + rz * Y2 - ry * Z2),
        y: s * (-rz * X2 + Y2 + rx * Z2),
        z: s * ( ry * X2 - rx * Y2 + Z2),
    };
}

// --- Lambert-72 ↔ WGS84 (public API) ---

export function lambert72ToWGS84(x, y) {
    // 1. Lambert inverse → BD72 geodetic
    const { n, aF, FE, FN, lam0 } = L72;
    const dx = x - FE;
    const dy = FN - y;
    const rho = Math.sqrt(dx * dx + dy * dy);
    const theta = Math.atan2(dx, dy);
    const lonBD = lam0 + theta / n;

    const e = Math.sqrt(2 * HAYFORD.f - HAYFORD.f * HAYFORD.f);
    const t = Math.pow(rho / aF, 1 / n);
    let latBD = Math.PI / 2 - 2 * Math.atan(t);
    for (let i = 0; i < 10; i++) {
        const es = e * Math.sin(latBD);
        latBD = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - es) / (1 + es), e / 2));
    }

    // 2. BD72 geodetic → BD72 ECEF → WGS84 ECEF → WGS84 geodetic
    const bdEcef = geodeticToEcef(latBD, lonBD, 0, HAYFORD);
    const wgsEcef = helmertBD72toWGS84(bdEcef.x, bdEcef.y, bdEcef.z);
    const { lat, lon } = ecefToGeodetic(wgsEcef.x, wgsEcef.y, wgsEcef.z, WGS84);

    return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

export function wgs84ToLambert72(latDeg, lonDeg) {
    // 1. WGS84 geodetic → WGS84 ECEF → BD72 ECEF → BD72 geodetic
    const latW = latDeg * Math.PI / 180;
    const lonW = lonDeg * Math.PI / 180;
    const wgsEcef = geodeticToEcef(latW, lonW, 0, WGS84);
    const bdEcef = helmertWGS84toBD72(wgsEcef.x, wgsEcef.y, wgsEcef.z);
    const { lat: latBD, lon: lonBD } = ecefToGeodetic(bdEcef.x, bdEcef.y, bdEcef.z, HAYFORD);

    // 2. Lambert forward
    const { n, aF, FE, FN, lam0 } = L72;
    const e = Math.sqrt(2 * HAYFORD.f - HAYFORD.f * HAYFORD.f);
    const es = e * Math.sin(latBD);
    const t = Math.tan(Math.PI / 4 - latBD / 2) /
              Math.pow((1 - es) / (1 + es), e / 2);
    const rho = aF * Math.pow(t, n);
    const theta = n * (lonBD - lam0);
    return {
        x: FE + rho * Math.sin(theta),
        y: FN - rho * Math.cos(theta),
    };
}
